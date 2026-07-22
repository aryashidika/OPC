export default {

	_counters: { ISP: 0, CS: 0, OSP: 0, IC: 0, IBT: 0 },
	_nodes: [],
	_edges: [],
	_anchorMap: {},
	_nodeId: 1,
	_slCount: 0,

	resetState() {
		LevelingJS._counters = { ISP: 0, CS: 0, OSP: 0, IC: 0, IBT: 0 };
		LevelingJS._nodes = [];
		LevelingJS._edges = [];
		LevelingJS._anchorMap = {};
		LevelingJS._nodeId = 1;
		LevelingJS._slCount = 0;
	},

	isSlRubberSupplier(supplierName) {
		return (supplierName ?? '').toLowerCase().includes('sl rubber');
	},

	resolveTreatmentCode(defaultPrefix, artikel, supplierName) {
		if (LevelingJS.isSlRubberSupplier(supplierName)) {
			LevelingJS._slCount += 1;
			return LevelingJS._slCount === 1
				? ('SL-' + artikel)
			: ('SL' + String(LevelingJS._slCount).padStart(2, '0') + '-' + artikel);
		}
		return LevelingJS.nextCode(defaultPrefix, artikel);
	},

	nextNodeId() {
		return LevelingJS._nodeId++;
	},

	getNodeTypeLabel(nodeType) {
		const labels = {
			fg: 'Finished Good',
			spine: 'Main Structure',
			cos_central: 'COS After Treatment',
			wip: 'Package Upper',
			stockfitting: 'Stockfitting Bottom',
			cutting_group: 'Grup Cutting',
			cutting_per_part: 'Cutting',
			part: 'Raw Material'
		};
		return labels[nodeType] || nodeType;
	},

	nextCode(prefix, artikel) {
		LevelingJS._counters[prefix] = (LevelingJS._counters[prefix] || 0) + 1;
		const nn = String(LevelingJS._counters[prefix]).padStart(2, '0');
		return prefix + nn + '-' + artikel;
	},

	addNode(code, name, type, meta = {}) {
		const id = LevelingJS.nextNodeId();
		LevelingJS._nodes.push({ id, code, name, type, ...meta });
		return id;
	},

	addEdge(fromId, toId) {
		LevelingJS._edges.push({ from: fromId, to: toId });
	},

	getAnchorId(anchor) {
		return LevelingJS._anchorMap[anchor] || null;
	},

	resolveParent(parentRules, partContext) {
		if (!parentRules || parentRules.length === 0) return null;
		for (var i = 0; i < parentRules.length; i++) {
			var rule = parentRules[i];
			if (rule.default) return LevelingJS.getAnchorId(rule.anchor);
			if (!rule.if && rule.anchor) return LevelingJS.getAnchorId(rule.anchor);
			if (rule.if) {
				var match = true;
				if (rule.if.cos_type !== undefined && partContext.cos_type !== rule.if.cos_type) match = false;
				if (rule.if.in_wip !== undefined && partContext.in_wip !== rule.if.in_wip) match = false;
				if (match) return LevelingJS.getAnchorId(rule.anchor);
			}
		}
		return null;
	},

	flattenWIPChain(rootWipId, wips) {
		const result = [];
		const stack = [{ wipId: rootWipId, depth: 0 }];
		const visited = [];
		while (stack.length > 0) {
			const current = stack.pop();
			if (visited.indexOf(current.wipId) !== -1) continue;
			visited.push(current.wipId);
			const wip = wips.find(function(w) { return w.id === current.wipId; });
			if (!wip) continue;
			result.push({ wip: wip, depth: current.depth });
			const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
			inputs.forEach(function(i) {
				if (i.kind === 'WIP') stack.push({ wipId: i.ref_prefixed, depth: current.depth + 1 });
			});
		}
		result.sort(function(a, b) { return a.depth - b.depth; });
		return result;
	},

	wipChainHasCosType(rootWipId, wips, cosType) {
		const chain = LevelingJS.flattenWIPChain(rootWipId, wips);
		for (var i = 0; i < chain.length; i++) {
			const inputs = typeof chain[i].wip.inputs === 'string'
			? JSON.parse(chain[i].wip.inputs) : chain[i].wip.inputs;
			for (var j = 0; j < inputs.length; j++) {
				if (inputs[j].kind === 'PART' && inputs[j].cos_type === cosType) return true;
			}
		}
		return false;
	},

	async onPageLoad() {
		if (!AuthJS.checkAuthGuard(['SPECSHEET_ADMIN', 'SPECSHEET_STAFF'], 'PRB')) return;

		await getArticleList.run();
	},

	async onArticleSelect() {
		if (!sel_article.selectedOptionValue) return;
		try {
			await Promise.all([
				getDivisionStatus.run(),
				getLevelingData.run(),
				getWIPDataForLeveling.run(),
				getCatalogForLeveling.run(),
				getLevelingNodes.run(),
				getPartsNotInLeveling.run()
			]);
		} catch (e) {
			showAlert('Gagal memuat data artikel: ' + e.message, 'error');
		}
	},


	validate(parts, wips) {
		const errors = [];
		const allPartIds = parts.map(function(p) { return p.part_db_id; });
		const allWIPIds = wips.map(function(w) { return w.id; });

		wips.forEach(function(w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			inputs.forEach(function(i) {
				if (i.kind === 'WIP' && i.ref_prefixed === w.id) {
					errors.push("CYCLE: Package '" + w.label + "' mengkonsumsi dirinya sendiri.");
				}
				if (i.kind === 'PART' && allPartIds.indexOf(i.ref) === -1) {
					errors.push("DANGLING: Package '" + w.label + "' referensi part id=" + i.ref + " tidak ditemukan.");
				}
				if (i.kind === 'WIP' && allWIPIds.indexOf(i.ref_prefixed) === -1) {
					errors.push("DANGLING: Package '" + w.label + "' referensi Package id=" + i.ref_prefixed + " tidak ditemukan.");
				}
			});
		});

		return errors;
	},


	buildSpine(artikel, parts) {
		const hasCentral = parts.some(function(p) { return p.cos_type === 'CENTRAL'; });

		const fgId = LevelingJS.addNode(artikel, 'FG SHOES', 'fg');
		LevelingJS._anchorMap['FG'] = fgId;

		const sId = LevelingJS.addNode('S-' + artikel, 'SEMI F/G SHOES', 'spine');
		LevelingJS.addEdge(sId, fgId);
		LevelingJS._anchorMap['S'] = sId;

		const suId = LevelingJS.addNode('SU-' + artikel, 'SEMI F/G UPPER', 'spine');
		LevelingJS.addEdge(suId, sId);
		LevelingJS._anchorMap['SU'] = suId;

		const fsId = LevelingJS.addNode('FS-' + artikel, 'SEMI F/G UPPER FEEDING SETTING', 'spine');
		LevelingJS.addEdge(fsId, suId);
		LevelingJS._anchorMap['FS'] = fsId;

		if (hasCentral) {
			const spId = LevelingJS.addNode('SP-' + artikel, 'SEMI F/G 2ND PROCESS COS', 'cos_central');
			LevelingJS.addEdge(spId, fsId);
			LevelingJS._anchorMap['SP'] = spId;
		}
	},

	buildGroupAll(artikel, parts, catalog) {
		const groupBehaviors = ['INLINE_GROUP', 'FEEDING_GROUP'];
		groupBehaviors.forEach(function(behavior) {
			const config = catalog.find(function(c) { return c.leveling_behavior === behavior; });
			if (!config) return;

			const matchingParts = parts.filter(function(p) {
				if (behavior === 'INLINE_GROUP') return p.cutting_type === 'INLINE';
				if (behavior === 'FEEDING_GROUP') return p.cutting_type === 'BOOTIE';
				return false;
			});
			if (matchingParts.length === 0) return;

			const firstPart = matchingParts[0];
			const parentId = LevelingJS.resolveParent(
				config.parent_rules,
				{ cos_type: firstPart.cos_type, in_wip: !!firstPart.upper_wip_id }
			);
			if (parentId === null) return;

			const groupCode = config.leveling_code + '-' + artikel;
			const groupName = behavior === 'INLINE_GROUP' ? 'CUTTING INLINE' : 'CUTTING BOOTIE';
			const groupId = LevelingJS.addNode(groupCode, groupName, 'cutting_group');
			LevelingJS.addEdge(groupId, parentId);

			matchingParts.forEach(function(p) {
				const partId = LevelingJS.addNode(p.part_id, p.part_name, 'part');
				LevelingJS.addEdge(partId, groupId);
			});
		});
	},

	buildWIPChains(artikel, parts, wips) {
		const upperWips = wips.filter(function(w) { return w.wip_source === 'upper'; });
		if (!upperWips.length) return;

		const consumedWIPIds = [];
		upperWips.forEach(function(w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			inputs.forEach(function(i) { if (i.kind === 'WIP') consumedWIPIds.push(i.ref_prefixed); });
		});

		const rootWIPs = upperWips
		.filter(function(w) { return consumedWIPIds.indexOf(w.id) === -1; })
		.sort(function(a, b) { return a.raw_id - b.raw_id; });

		function codeSeq(code) {
			const m = /^[A-Za-z]+(\d+)/.exec(code || '');
			return m ? parseInt(m[1], 10) : 0;
		}

		rootWIPs.forEach(function(rootWip) {
			const hasCentral = LevelingJS.wipChainHasCosType(rootWip.id, upperWips, 'CENTRAL');
			const parentId = LevelingJS.getAnchorId(hasCentral ? 'SP' : 'FS');
			if (parentId === null) return;

			const chain = LevelingJS.flattenWIPChain(rootWip.id, upperWips);
			const wipNodeMap = {};

			const childrenOf = {};
			const parentOf = {};
			chain.forEach(function(item) {
				const wip = item.wip;
				const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
				const kids = inputs.filter(function(i) { return i.kind === 'WIP'; }).map(function(i) { return i.ref_prefixed; });
				childrenOf[wip.id] = kids;
				kids.forEach(function(k) { parentOf[k] = wip.id; });
			});

			const codeOf = {};
			chain.forEach(function(item) {
				codeOf[item.wip.id] = LevelingJS.resolveTreatmentCode('ISP', artikel, item.wip.supplier_name);
			});

			const branchCache = {};
			function getBranchInfo(wipId) {
				if (branchCache[wipId]) return branchCache[wipId];
				const wip = chain.find(function(it) { return it.wip.id === wipId; }).wip;
				const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
				const partInputs = inputs.filter(function(i) { return i.kind === 'PART'; });
				const kids = childrenOf[wipId] || [];
				const isSL = LevelingJS.isSlRubberSupplier(wip.supplier_name);

				let result = { partName: null, seq: 0, originCode: null };

				if (kids.length === 1) {
					const childInfo = getBranchInfo(kids[0]);
					if (childInfo.partName) {
						result = {
							partName: childInfo.partName,
							seq: isSL ? childInfo.seq : childInfo.seq + 1,
							originCode: childInfo.originCode
						};
					}
				} else if (kids.length > 1) {
					let winner = null;
					kids.forEach(function(k) {
						const kInfo = getBranchInfo(k);
						if (!kInfo.partName) return;
						if (winner === null || codeSeq(kInfo.originCode) < codeSeq(winner.originCode)) {
							winner = kInfo;
						}
					});
					if (winner) {
						result = {
							partName: winner.partName,
							seq: isSL ? winner.seq : winner.seq + 1,
							originCode: winner.originCode
						};
					}
				}

				if (!result.partName && !isSL && partInputs.length > 0) {
					const fp = parts.find(function(p) { return p.part_db_id === partInputs[0].ref; });
					if (fp) result = { partName: fp.part_name, seq: 1, originCode: codeOf[wipId] };
				}

				branchCache[wipId] = result;
				return result;
			}

			chain.forEach(function(item) { getBranchInfo(item.wip.id); }); 

			const maxSeqByOrigin = {};
			chain.forEach(function(item) {
				const info = branchCache[item.wip.id];
				if (info && info.originCode) {
					maxSeqByOrigin[info.originCode] = Math.max(maxSeqByOrigin[info.originCode] || 0, info.seq);
				}
			});

			chain.forEach(function(item) {
				const wip = item.wip;
				const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
				const partInputs = inputs.filter(function(i) { return i.kind === 'PART'; });

				const isCode = codeOf[wip.id];

				let isName = wip.label;
				if (LevelingJS.isSlRubberSupplier(wip.supplier_name)) {
					isName = 'SL RUBBER PROCESS_' + artikel;
				} else {
					const info = branchCache[wip.id];
					if (info.partName) {
						const total = maxSeqByOrigin[info.originCode] || info.seq;
						isName = info.partName + ' LOGO' + (total > 1 ? ' ' + info.seq : '');
					}
				}

				const isId = LevelingJS.addNode(isCode, isName, 'wip', {
					leadTimeDays: wip.lead_time_days,
					dbrefType: 'upper_wip',
					dbrefId: wip.raw_id
				});
				wipNodeMap[wip.id] = isId;

				if (wip.id === rootWip.id) {
					LevelingJS.addEdge(isId, parentId);
				} else {
					const parentWipId = parentOf[wip.id];
					if (parentWipId && wipNodeMap[parentWipId]) {
						LevelingJS.addEdge(isId, wipNodeMap[parentWipId]);
					}
				}

				partInputs.forEach(function(input) {
					const partData = parts.find(function(p) { return p.part_db_id === input.ref; });
					if (!partData) return;
					if (partData.cutting_type === 'NORMAL') {
						const osCode = LevelingJS.nextCode('OSP', artikel);
						const osId = LevelingJS.addNode(osCode, partData.part_name, 'cutting_per_part');
						LevelingJS.addEdge(osId, isId);
						const partId = LevelingJS.addNode(partData.part_id, partData.part_name, 'part');
						LevelingJS.addEdge(partId, osId);
					} else {
						const partId = LevelingJS.addNode(partData.part_id, partData.part_name, 'part');
						LevelingJS.addEdge(partId, isId);
					}
				});
			});
		});
	},

	buildNormalCutting(artikel, parts) {
		const normalParts = parts.filter(function(p) {
			return p.cutting_type === 'NORMAL' && !p.upper_wip_id;
		});
		if (!normalParts.length) return;

		const groups = {};
		normalParts.forEach(function(p) {
			const anchor = p.cos_type === 'CENTRAL' ? 'SP' : 'FS';
			if (!groups[anchor]) groups[anchor] = [];
			groups[anchor].push(p);
		});

		Object.keys(groups).forEach(function(anchor) {
			const parentId = LevelingJS.getAnchorId(anchor);
			if (parentId === null) return;
			const csCode = LevelingJS.nextCode('CS', artikel);
			const csId = LevelingJS.addNode(csCode, 'CUTTING NORMAL', 'cutting_group');
			LevelingJS.addEdge(csId, parentId);
			groups[anchor].forEach(function(p) {
				const icCode = LevelingJS.nextCode('IC', artikel);
				const icId = LevelingJS.addNode(icCode, p.part_name, 'cutting_per_part');
				LevelingJS.addEdge(icId, csId);
				const partId = LevelingJS.addNode(p.part_id, p.part_name, 'part');
				LevelingJS.addEdge(partId, icId);
			});
		});
	},

	buildDirectParts(artikel, parts) {
		const directParts = parts.filter(function(p) {
			return p.cos_type === 'CENTRAL' && !p.upper_wip_id && !p.cutting_type;
		});
		if (!directParts.length) return;

		const spId = LevelingJS.getAnchorId('SP');
		if (spId === null) return;

		directParts.forEach(function(p) {
			const partId = LevelingJS.addNode(p.part_id, p.part_name, 'part');
			LevelingJS.addEdge(partId, spId);
		});
	},

	buildBottomChains(artikel, parts, wips) {
		const bottomWips = wips.filter(function(w) { return w.wip_source === 'bottom'; });
		const sId = LevelingJS.getAnchorId('S');
		if (sId === null) return;

		// Q1 lives here — flip to `=== 'NORMAL'` if that is the agreed predicate.
		function partHasCutting(partData) {
			return !!partData && partData.cutting_type !== null
			&& partData.cutting_type !== undefined && partData.cutting_type !== '';
		}

		if (!bottomWips.length) {
			parts.forEach(function(p) {
				if (p.is_bought_ready) {
					const partNodeId = LevelingJS.addNode(p.part_id, p.part_name, 'part');
					LevelingJS.addEdge(partNodeId, sId);
				}
			});
			return;
		}

		const wipNodeMap = {};
		const consumedWIPIds = [];
		bottomWips.forEach(function(w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			inputs.forEach(function(i) { if (i.kind === 'WIP') consumedWIPIds.push('B' + i.ref); });
		});

		const rootWIPs = bottomWips
		.filter(function(w) { return consumedWIPIds.indexOf(w.id) === -1; })
		.sort(function(a, b) { return a.raw_id - b.raw_id; });

		function flattenBottomChain(rootWipId) {
			const result = [];
			const stack = [{ wipId: rootWipId, depth: 0 }];
			const visited = [];
			while (stack.length > 0) {
				const current = stack.pop();
				if (visited.indexOf(current.wipId) !== -1) continue;
				visited.push(current.wipId);
				const wip = bottomWips.find(function(w) { return w.id === current.wipId; });
				if (!wip) continue;
				result.push({ wip: wip, depth: current.depth });
				const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
				inputs.forEach(function(i) {
					if (i.kind === 'WIP') stack.push({ wipId: 'B' + i.ref, depth: current.depth + 1 });
				});
			}
			result.sort(function(a, b) { return a.depth - b.depth; });
			return result;
		}

		rootWIPs.forEach(function(rootWip) {
			const chain = flattenBottomChain(rootWip.id);
			const treatmentFlags = {};
			chain.forEach(function(item) {
				const wip = item.wip;
				if (wip.wip_type === 'SB') {
					treatmentFlags[wip.id] = false;
				} else if (wip.is_sockliner_wip) {
					const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
					const partInputs = inputs.filter(function(i) { return i.kind === 'PART'; });
					const anyCut = partInputs.some(function(inp) {
						return partHasCutting(parts.find(function(p) { return p.part_db_id === inp.ref; }));
					});
					treatmentFlags[wip.id] = anyCut; 
				} else {
					treatmentFlags[wip.id] = true; 
				}
			});

			const chainPartName = (function() {
				for (var d = chain.length - 1; d >= 0; d--) {
					const item = chain[d];
					if (!treatmentFlags[item.wip.id] || !item.wip.is_sockliner_wip) continue;
					const inputs = typeof item.wip.inputs === 'string' ? JSON.parse(item.wip.inputs) : item.wip.inputs;
					const pInputs = inputs.filter(function(i) { return i.kind === 'PART'; });
					if (pInputs.length > 0) {
						const fp = parts.find(function(p) { return p.part_db_id === pInputs[0].ref; });
						if (fp) return fp.part_name;
					}
				}
				return null;
			})();

			const inSubOrder = chain
			.filter(function(item) { return treatmentFlags[item.wip.id] && item.wip.is_sockliner_wip && !LevelingJS.isSlRubberSupplier(item.wip.supplier_name); })
			.sort(function(a, b) { return b.depth - a.depth; })
			.map(function(item) { return item.wip.id; });

			const ibtOrder = chain
			.filter(function(item) { return treatmentFlags[item.wip.id] && !item.wip.is_sockliner_wip && !LevelingJS.isSlRubberSupplier(item.wip.supplier_name); })
			.sort(function(a, b) { return b.depth - a.depth; })
			.map(function(item) { return item.wip.id; });

			chain.forEach(function(item) {
				const wip = item.wip;
				const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
				const partInputs = inputs.filter(function(i) { return i.kind === 'PART'; });

				let nodeCode, nodeType, isTreatmentNode;
				if (wip.wip_type === 'SB') {
					nodeCode = 'SB-' + artikel;
					nodeType = 'stockfitting';
					isTreatmentNode = false;
				} else if (wip.is_sockliner_wip) {
					const anyCut = partInputs.some(function(inp) {
						return partHasCutting(parts.find(function(p) { return p.part_db_id === inp.ref; }));
					});
					if (anyCut) {
						nodeCode = LevelingJS.resolveTreatmentCode('ISP', artikel, wip.supplier_name);
						isTreatmentNode = true;
					} else {
						nodeCode = 'ZSS-' + artikel;
						isTreatmentNode = false;
					}
					nodeType = 'wip';
				} else {
					nodeCode = LevelingJS.resolveTreatmentCode('IBT', artikel, wip.supplier_name);
					nodeType = 'wip';
					isTreatmentNode = true;
				}

				let nodeName = wip.label;
				if (isTreatmentNode) {
					if (LevelingJS.isSlRubberSupplier(wip.supplier_name)) {
						nodeName = 'SL RUBBER PROCESS_' + artikel;
					} else if (!wip.is_sockliner_wip) {
						const seq = ibtOrder.indexOf(wip.id) + 1;
						const firstIbtPart = partInputs.length > 0
						? parts.find(function(p) { return p.part_db_id === partInputs[0].ref; })
						: null;
						const isMidsole = firstIbtPart && (firstIbtPart.part_name || '').toUpperCase().includes('MIDSOLE');
						const ibtLabel = isMidsole ? 'IN.SUB MIDSOLE LOGO' : 'IN.SUB OUTSOLE LOGO';
						nodeName = ibtLabel + (ibtOrder.length > 1 ? ' ' + seq : '');
					} else if (chainPartName) {
						const seq = inSubOrder.indexOf(wip.id) + 1;
						nodeName = chainPartName + ' LOGO' + (inSubOrder.length > 1 ? ' ' + seq : '');
					} else if (partInputs.length > 0) {
						const firstPart = parts.find(function(p) { return p.part_db_id === partInputs[0].ref; });
						if (firstPart) nodeName = firstPart.part_name + ' LOGO';
					}
				}

				const nodeId = LevelingJS.addNode(nodeCode, nodeName, nodeType, {
					leadTimeDays: wip.lead_time_days,
					dbrefType: 'bottom_wip',
					dbrefId: wip.raw_id
				});
				wipNodeMap[wip.id] = nodeId;

				if (wip.id === rootWip.id) {
					LevelingJS.addEdge(nodeId, sId);
				} else {
					const parentWip = bottomWips.find(function(w) {
						const inp = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
						return inp.some(function(i) { return i.kind === 'WIP' && 'B' + i.ref === wip.id; });
					});
					if (parentWip && wipNodeMap[parentWip.id]) {
						LevelingJS.addEdge(nodeId, wipNodeMap[parentWip.id]);
					}
				}

				if (nodeType === 'stockfitting') {
					let csId = null;
					partInputs.forEach(function(input) {
						const partData = parts.find(function(p) { return p.part_db_id === input.ref; });
						if (!partData) return;

						if (partData.cutting_type === 'NORMAL') {
							if (csId === null) {
								const csCode = LevelingJS.nextCode('CS', artikel);
								csId = LevelingJS.addNode(csCode, 'CUTTING NORMAL', 'cutting_group');
								LevelingJS.addEdge(csId, nodeId);
							}
							const icCode = LevelingJS.nextCode('IC', artikel);
							const icId = LevelingJS.addNode(icCode, partData.part_name, 'cutting_per_part');
							LevelingJS.addEdge(icId, csId);
							const partNodeId = LevelingJS.addNode(partData.part_id, partData.part_name, 'part');
							LevelingJS.addEdge(partNodeId, icId);
						} else {
							const partNodeId = LevelingJS.addNode(partData.part_id, partData.part_name, 'part');
							LevelingJS.addEdge(partNodeId, nodeId);
						}
					});
				} else {
					partInputs.forEach(function(input) {
						const partData = parts.find(function(p) { return p.part_db_id === input.ref; });
						if (!partData) return;

						const makeOS = wip.is_sockliner_wip
						? partHasCutting(partData)
						: (partData.cutting_type === 'NORMAL');

						if (makeOS) {
							const osCode = LevelingJS.nextCode('OSP', artikel);
							const osId = LevelingJS.addNode(osCode, partData.part_name, 'cutting_per_part');
							LevelingJS.addEdge(osId, nodeId);
							const partNodeId = LevelingJS.addNode(partData.part_id, partData.part_name, 'part');
							LevelingJS.addEdge(partNodeId, osId);
						} else {
							const partNodeId = LevelingJS.addNode(partData.part_id, partData.part_name, 'part');
							LevelingJS.addEdge(partNodeId, nodeId);
						}
					});
				}
			});
		});

		parts.forEach(function(p) {
			if (p.is_bought_ready) {
				const partNodeId = LevelingJS.addNode(p.part_id, p.part_name, 'part');
				LevelingJS.addEdge(partNodeId, sId);
			}
		});
	},

	async onGenerate() {
		LevelingJS.resetState();

		try {
			await getLevelingData.run();
			await getWIPDataForLeveling.run();
			await getCatalogForLeveling.run();

			const parts = getLevelingData.data || [];
			const wips = getWIPDataForLeveling.data || [];
			const catalog = getCatalogForLeveling.data || [];
			const artikel = sel_article.selectedOptionValue || '';

			if (!artikel) {
				showAlert('Pilih article dulu.', 'warning');
				return;
			}

			const errors = LevelingJS.validate(parts, wips);
			if (errors.length > 0) {
				storeValue('levelingErrors', errors);
				storeValue('levelingResult', null);
				storeValue('levelingTrigger', Date.now());
				showAlert('Ada ' + errors.length + ' error validasi.', 'error');
				return;
			}

			storeValue('levelingErrors', []);

			const upperWips = wips.filter(function(w) { return w.wip_source === 'upper'; });
			const partsInUpperWIP = [];
			upperWips.forEach(function(w) {
				const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
				inputs.forEach(function(i) { if (i.kind === 'PART') partsInUpperWIP.push(i.ref); });
			});
			const partsNotInWIP = parts.filter(function(p) {
				return partsInUpperWIP.indexOf(p.part_db_id) === -1;
			});

			LevelingJS.buildSpine(artikel, parts);
			LevelingJS.buildGroupAll(artikel, partsNotInWIP, catalog);
			LevelingJS.buildWIPChains(artikel, parts, wips);
			LevelingJS.buildNormalCutting(artikel, partsNotInWIP);
			LevelingJS.buildDirectParts(artikel, partsNotInWIP);
			LevelingJS.buildBottomChains(artikel, parts, wips);

			LevelingJS.computeLevels();
			await LevelingJS.saveGeneratedLeveling(artikel);

			storeValue('levelingResult', {
				nodes: LevelingJS._nodes,
				edges: LevelingJS._edges
			});
			storeValue('levelingTrigger', Date.now());
			showAlert('Leveling berhasil di-generate!', 'success');
		} catch (e) {
			storeValue('levelingResult', null);
			storeValue('levelingTrigger', Date.now());
			showAlert('Gagal generate leveling: ' + e.message, 'error');
		}
	},

	// ─── RENDER ────────────────────────────────────────────

	getErrors() {
		return appsmith.store.levelingErrors || [];
	},

	getLevelingHTML() {
		const _ = appsmith.store.levelingTrigger;
		const result = appsmith.store.levelingResult;

		if (!result) {
			return '<html><body style="font-family:sans-serif;padding:20px;color:#94a3b8;">Klik "Generate Leveling" untuk mulai.</body></html>';
		}

		const { nodes, edges } = result;
		const nodeColors = {
			fg: '#1e40af',
			spine: '#0369a1',
			cos_central: '#059669',
			wip: '#7c3aed',
			stockfitting: '#0891b2',
			cutting_group: '#d97706',
			cutting_per_part: '#b45309',
			part: '#64748b'
		};

		const childMap = {};
		edges.forEach(function(e) {
			if (!childMap[e.to]) childMap[e.to] = [];
			childMap[e.to].push(e.from);
		});

		function renderNode(nodeId, depth) {
			const node = nodes.find(function(n) { return n.id === nodeId; });
			if (!node) return '';
			const color = nodeColors[node.type] || '#64748b';
			const indent = depth * 24;
			const children = childMap[nodeId] || [];
			let html = '<div style="margin-left:' + indent + 'px;margin-bottom:6px;">' +
					'<span style="background:' + color + ';color:white;padding:3px 10px;' +
					'border-radius:4px;font-size:13px;font-family:monospace;">' +
					node.code + '</span> ' +
					'<span style="font-size:13px;color:#1e293b;">' + node.name + '</span>' +
					'</div>';
			children.forEach(function(childId) {
				html += renderNode(childId, depth + 1);
			});
			return html;
		}

		const fgNode = nodes.find(function(n) { return n.type === 'fg'; });
		const bodyHtml = fgNode ? renderNode(fgNode.id, 0) : '<p>Tidak ada data.</p>';

		return '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;background:#f8fafc;">' +
			'<h3 style="color:#1e293b;margin-bottom:16px;">Leveling Upper — ' +
			(sel_article.selectedOptionValue || '') + '</h3>' +
			bodyHtml +
			'</body></html>';
	},

	onExportExcel() {
		showAlert('Export Excel akan diimplementasi berikutnya.', 'info');
	},

	computeLevels() {
		const childMap = {};
		LevelingJS._edges.forEach(function(e) {
			if (!childMap[e.to]) childMap[e.to] = [];
			childMap[e.to].push(e.from);
		});
		const fgNode = LevelingJS._nodes.find(function(n) { return n.type === 'fg'; });
		if (!fgNode) return;

		const levelMap = {};
		const queue = [{ id: fgNode.id, level: 1 }];
		while (queue.length > 0) {
			const cur = queue.shift();
			if (levelMap[cur.id] !== undefined) continue;
			levelMap[cur.id] = cur.level;
			(childMap[cur.id] || []).forEach(function(childId) {
				queue.push({ id: childId, level: cur.level + 1 });
			});
		}
		LevelingJS._nodes.forEach(function(n) {
			n.level = levelMap[n.id] || 1;
		});
	},

	async saveGeneratedLeveling(artikel) {
		const sessionRows = await getCurrentSessionId.run({ articleId: artikel });
		if (!sessionRows || sessionRows.length === 0) {
			throw new Error('Session tidak ditemukan untuk artikel ' + artikel);
		}
		const sessionId = sessionRows[0].id;

		const esc = (s) => {
			if (s === null || s === undefined) return 'NULL';
			return `'${String(s).replace(/'/g, "''")}'`;
		};

		const values = LevelingJS._nodes.map(function(n) {
			const partIdVal = n.type === 'part' ? n.code : null;
			const edge = LevelingJS._edges.find(function(e) { return e.from === n.id; });
			const parentNode = edge ? LevelingJS._nodes.find(function(x) { return x.id === edge.to; }) : null;
			const parentCode = parentNode ? parentNode.code : null;

			return `(${sessionId}, ${n.level || 1}, ${esc(n.code)}, ${esc(n.type)}, ${esc(n.name)}, ${esc(partIdVal)}, ${esc(parentCode)}, false, ${n.leadTimeDays != null ? n.leadTimeDays : 'NULL'}, ${esc(n.dbrefType || null)}, ${n.dbrefId != null ? n.dbrefId : 'NULL'})`;
		}).join(',\n');

		await deleteGeneratedLeveling.run({ sessionId });
		await insertLevelingNodes.run({ values });
		await getLevelingNodes.run();
	},

	async batchManualAddParts() {
		const selectedRows = tbl_partsNotInLeveling.selectedRows;
		if (!selectedRows || selectedRows.length === 0) {
			showAlert('Pilih minimal 1 part!', 'warning');
			return;
		}
		const parentCode = inp_manualParentCode.text.trim();
		if (!parentCode) {
			showAlert('Parent Code wajib diisi!', 'warning');
			return;
		}
		const parentExists = (getLevelingNodes.data || []).some(function(r) { return r.node_code === parentCode; });
		if (!parentExists) {
			showAlert('Parent Code "' + parentCode + '" tidak ditemukan di leveling!', 'warning');
			return;
		}
		const articleId = sel_article.selectedOptionValue;
		let successCount = 0;
		for (const row of selectedRows) {
			try {
				await addManualLevelingNode.run({
					articleId: articleId,
					nodeCode: row.part_id,
					nodeType: 'part',
					nodeName: row.part_name,
					partId: row.part_id,
					parentCode: parentCode
				});
				successCount++;
			} catch (e) {
				console.log('Gagal insert part: ' + row.part_name, e);
			}
		}
		await getLevelingNodes.run();
		await getPartsNotInLeveling.run();
		showAlert(successCount + ' part berhasil ditambahkan ke leveling!', 'success');
	},

	async addManualStructuralNode() {
		const nodeType = sel_manualNodeType.selectedOptionValue;
		const parentCode = inp_manualParentCode2.text.trim();
		const nodeName = inp_manualNodeName.text.trim() || '-';
		const nodeCodeInput = inp_manualNodeCode.text.trim();

		if (!nodeType) {
			showAlert('Tipe node wajib dipilih!', 'warning');
			return;
		}
		if (!parentCode) {
			showAlert('Parent Code wajib diisi!', 'warning');
			return;
		}
		const levelingData = getLevelingNodes.data || [];
		const parentExists = levelingData.some(function(r) { return r.node_code === parentCode; });
		if (!parentExists) {
			showAlert('Parent Code "' + parentCode + '" tidak ditemukan di leveling!', 'warning');
			return;
		}
		if (!nodeCodeInput) {
			showAlert('Node Code wajib diisi!', 'warning');
			return;
		}
		const isDuplicate = levelingData.some(function(r) { return r.node_code === nodeCodeInput; });
		if (isDuplicate) {
			showAlert('Node Code "' + nodeCodeInput + '" sudah ada di leveling!', 'warning');
			return;
		}

		try {
			await addManualLevelingNode.run({
				articleId: sel_article.selectedOptionValue,
				nodeCode: nodeCodeInput,
				nodeType: nodeType,
				nodeName: nodeName,
				partId: null,
				parentCode: parentCode
			});
			await getLevelingNodes.run();
			showAlert('Node berhasil ditambahkan!', 'success');
		} catch (e) {
			showAlert('Gagal: ' + e.message, 'error');
		}
	},

	async removeSelectedLevelingRows() {
		const selected = tbl_leveling.selectedRows;
		if (!selected || selected.length === 0) {
			showAlert('Pilih minimal 1 row!', 'warning');
			return;
		}

		const hasNonManual = selected.some(function(r) { return !r.is_manual; });
		if (hasNonManual) {
			showAlert('Hanya baris hasil input manual yang bisa dihapus. Node hasil generate otomatis tidak bisa dihapus di sini.', 'warning');
			return;
		}

		const levelingData = getLevelingNodes.data || [];
		const selectedCodes = selected.map(function(r) { return r.node_code; }).filter(function(c) { return c; });
		const hasChildren = selectedCodes.some(function(code) {
			return levelingData.some(function(r) { return r.parent_code === code; });
		});
		if (hasChildren) {
			showAlert('Tidak bisa dihapus: ada node lain yang bergantung pada entry ini!', 'warning');
			return;
		}

		try {
			await removeSelectedLevelingNodes.run({
				ids: selected.map(function(r) { return r.id; }).join(','),
				articleId: sel_article.selectedOptionValue
			});
			await getLevelingNodes.run();
			await getPartsNotInLeveling.run();
			showAlert(selected.length + ' entry berhasil dihapus!', 'success');
		} catch (e) {
			showAlert('Gagal: ' + e.message, 'error');
		}
	},

	async onRefresh() {
		if (!sel_article.selectedOptionValue) {
			showAlert('Pilih article dulu.', 'warning');
			return;
		}
		try {
			await getLevelingNodes.run();
			await getPartsNotInLeveling.run();
			showAlert('Data leveling berhasil di-refresh.', 'success');
		} catch (e) {
			showAlert('Gagal refresh: ' + e.message, 'error');
		}
	},

}