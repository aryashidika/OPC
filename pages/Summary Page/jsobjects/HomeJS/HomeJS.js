export default {

	async loadXLSXLib() {
		if (typeof window.XLSX === "undefined") {
			await import("https://cdn.jsdelivr.net/npm/xlsx/+esm").then((m) => {
				window.XLSX = m;
			});
		}
		return window.XLSX;
	},

	onPageLoad: function () {
		const u = appsmith.store.currentUser;
		const SESSION_HOURS = 12;
		const expired = !u || !u.loginAt || (Date.now() - u.loginAt) > SESSION_HOURS * 3600 * 1000;
		if (expired) {
			storeValue('currentUser', null);
			navigateTo('Login');
		}
	},

	async createNewSession(articleId, parts, parentSessionId, modelNumber, deltaResult, season) {
		showAlert("Membuat session...", "info");

		let session;
		try {
			const sessionResult = await createSessionAtomic.run({
				articleId,
				parentSessionId: parentSessionId ?? '',
				modelNumber: modelNumber ?? null,
				season: season ?? null
			});
			session = sessionResult[0];
		} catch (e) {
			showAlert("Gagal buat session: " + e.message, "error");
			return;
		}

		try {
			await saveParts.run({
				sessionId: session.id,
				partsJson: JSON.stringify(parts)
			});
		} catch (e) {
			showAlert("Gagal save parts: " + e.message, "error");
			return;
		}

		if (parentSessionId) {
			try {
				await carryOverPartProcessIngest.run({
					oldSessionId: parentSessionId,
					newSessionId: session.id
				});
			} catch (e) {
				showAlert("Gagal carry-over assignment: " + e.message, "error");
				return;
			}

			try {
				await carryOverWIPIngest.run({
					oldSessionId: parentSessionId,
					newSessionId: session.id
				});
			} catch (e) {
				showAlert("Gagal carry-over Package: " + e.message, "error");
				return;
			}

			try {
				await carryOverWIPInputIngest.run({
					oldSessionId: parentSessionId,
					newSessionId: session.id
				});
			} catch (e) {
				showAlert("Gagal carry-over Package input: " + e.message, "error");
				return;
			}

			try {
				const cosPkgMapping = await carryOverCOSPkgIngest.run({
					oldSessionId: parentSessionId,
					newSessionId: session.id
				});
				if (cosPkgMapping && cosPkgMapping.length > 0) {
					await Promise.all(cosPkgMapping.map(function (m) {
						return carryOverCOSPkgAssignIngest.run({
							oldSessionId: parentSessionId,
							newSessionId: session.id,
							oldPackageId: m.old_package_id,
							newPackageId: m.new_package_id
						});
					}));
				}
			} catch (e) {
				showAlert("Gagal carry-over COS package: " + e.message, "error");
				return;
			}

			try {
				const bfrPkgMapping = await carryOverBfrPkgIngest.run({
					oldSessionId: parentSessionId,
					newSessionId: session.id
				});
				if (bfrPkgMapping && bfrPkgMapping.length > 0) {
					await Promise.all(bfrPkgMapping.map(function (m) {
						return carryOverBfrPkgAssignIngest.run({
							oldSessionId: parentSessionId,
							newSessionId: session.id,
							oldPackageId: m.old_package_id,
							newPackageId: m.new_package_id
						});
					}));
				}
			} catch (e) {
				showAlert("Gagal carry-over before package: " + e.message, "error");
				return;
			}
		}

		try {
			await carryOverBtmWIPIngest.run({
				oldSessionId: parentSessionId,
				newSessionId: session.id
			});
		} catch (e) {
			showAlert('Gagal carry-over bottom Package: ' + e.message, 'error');
			return;
		}

		try {
			await carryOverBtmWIPInputIngest.run({
				oldSessionId: parentSessionId,
				newSessionId: session.id
			});
		} catch (e) {
			showAlert('Gagal carry-over bottom Package input: ' + e.message, 'error');
			return;
		}

		try {
			if (parentSessionId && deltaResult) {
				await initDivisionStatusSmart.run({
					newSessionId: session.id,
					oldSessionId: parentSessionId,
					deltaJson: JSON.stringify(deltaResult)
				});
			} else {
				await initDivisionStatus.run({ sessionId: session.id });
			}
		} catch (e) {
			showAlert("Gagal set division status: " + e.message, "error");
			return;
		}


		await getAllActiveSessions.run();
		showAlert(
			"Session Rev." + session.revision_no + " berhasil dibuat. " + parts.length + " part loaded.",
			"success"
		);
	},

	navigateToDivision(sessionId, articleId, division) {
		const pageMap = {
			'BLACKBOX':           'Blackbox (Laminating)',
			'COMMERZ':            'Commerz (Cutting)',
			'COS':                'COS (Computer Stitching)',
			'UPPER_TOOLING':      'UT (Upper Treatment)',
			'BOTTOM_ENGINEERING': 'Bottom Engineering'
		};
		const page = pageMap[division];
		if (!page) return;
		navigateTo(page, { article_id: articleId }, 'SAME_WINDOW');
	},

	async onToggleReleased() {
		const current = appsmith.store.showReleased ?? false;
		if (!current) {
			await getReleasedSessions.run();
		}
		storeValue('showReleased', !current);
	},

	readMeta(rows, labelRe) {
		const norm = (v) => (v === null || v === undefined ? '' : v.toString().trim());
		const maxScan = Math.min(rows.length, 15);
		for (let r = 0; r < maxScan; r++) {
			const row = rows[r] || [];
			for (let c = 0; c < row.length; c++) {
				if (labelRe.test(norm(row[c]).toLowerCase())) {
					for (let k = c + 1; k < row.length; k++) {
						if (norm(row[k]) !== '') return norm(row[k]);
					}
				}
			}
		}
		return '';
	},

	async parseModelExcel(base64Data) {
		const XLSXLib = await this.loadXLSXLib();

		const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
		const workbook = XLSXLib.read(cleanBase64, { type: 'base64' });
		const sheetName = workbook.SheetNames[0];
		const sheet = workbook.Sheets[sheetName];

		const rows = XLSXLib.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

		const norm = (v) => (v === null || v === undefined ? '' : v.toString().trim());
		const normLower = (v) => norm(v).toLowerCase();

		const modelNumberFromFile = this.readMeta(rows, /^model\s*#?$|model number/);
		const seasonFromFile      = this.readMeta(rows, /^season/);
		if (!modelNumberFromFile) {
			throw new Error('Baris "Model #" tidak ditemukan di file.');
		}

		let headerRowIdx = -1;
		for (let i = 0; i < rows.length; i++) {
			if (rows[i].some((c) => normLower(c) === 'part id')) {
				headerRowIdx = i;
				break;
			}
		}
		if (headerRowIdx === -1 || headerRowIdx === 0) {
			throw new Error('Format Excel tidak dikenali: baris header "Part ID" tidak ditemukan.');
		}
		const headerRow = rows[headerRowIdx];

		const findCol = (predicate) => headerRow.findIndex((c) => predicate(normLower(c)));
		const partIdCol       = findCol((h) => h === 'part id');
		const partNameCol     = findCol((h) => h === 'part name');
		const mlmIdCol         = findCol((h) => h.includes('material reference'));
		const materialDescCol = findCol((h) => h === 'material name');
		const supplierCol     = findCol((h) => h === 'supplier name');
		const prodUomCol      = findCol((h) => h === 'production uom');

		if (partIdCol === -1 || partNameCol === -1) {
			throw new Error('Format Excel tidak dikenali: kolom "Part ID" / "Part Name" tidak ditemukan.');
		}

		const blocks = [];
		for (let i = 0; i < headerRow.length - 2; i++) {
			if (
				normLower(headerRow[i]) === 'color' &&
				normLower(headerRow[i + 1]) === 'color treatments' &&
				normLower(headerRow[i + 2]) === 'production color indicator'
			) {
				blocks.push({ colorCol: i, colorTreatCol: i + 1, indicatorCol: i + 2 });
				i += 2;
			}
		}
		if (blocks.length === 0) {
			throw new Error('Format Excel tidak dikenali: tidak ditemukan blok warna (Color/Color Treatments/Production Color Indicator).');
		}

		const groupHeaderRowIdxs = [];
		const MAX_SCAN_UP = 20;
		for (let r = headerRowIdx - 1, scanned = 0; r >= 0 && scanned < MAX_SCAN_UP; r--, scanned++) {
			const rowHasContent = blocks.some((b) => norm(rows[r][b.colorCol]) !== '');
			if (!rowHasContent) break;
			groupHeaderRowIdxs.unshift(r);
		}
		if (groupHeaderRowIdxs.length === 0) {
			throw new Error('Format Excel tidak dikenali: baris header grup artikel (berisi ARTICLE_ID) tidak ditemukan di atas header field.');
		}

		const articleSlots = [];
		blocks.forEach((b) => {
			groupHeaderRowIdxs.forEach((r) => {
				const text = norm(rows[r][b.colorCol]);
				if (text === '') return;

				const segments = text.split('|');
				if (segments.length < 2) {
					throw new Error(`Header grup artikel tidak sesuai format "desc | ARTICLE_ID | status" di baris ${r + 1}, kolom ${b.colorCol}: "${text}"`);
				}
				const article_id = segments[segments.length - 2].trim();
				articleSlots.push({ article_id, block: b });
			});
		});

		if (articleSlots.length === 0) {
			throw new Error('Tidak ada artikel valid terbaca dari header grup.');
		}

		let dataStartIdx = headerRowIdx + 1;
		const maybeSection = rows[dataStartIdx];
		if (maybeSection) {
			const hasPartId = norm(maybeSection[partIdCol]) !== '';
			const hasAnyText = maybeSection.some((c) => norm(c) !== '');
			if (!hasPartId && hasAnyText) {
				dataStartIdx += 1;
			}
		}

		const rawRows = [];
		let currentSection = null;
		const KNOWN_SECTIONS = ['UPPER', 'BOTTOM', 'COSTING', 'PACKAGING'];

		for (let i = dataStartIdx; i < rows.length; i++) {
			const r = rows[i];
			const isEmpty = !r || r.every((c) => norm(c) === '');
			if (isEmpty) break;

			if (norm(r[partIdCol]) === '') {
				const label = norm(r[partNameCol]).toUpperCase();
				if (KNOWN_SECTIONS.includes(label)) {
					currentSection = label;
				}
				continue;
			}

			rawRows.push({
				part_id:       norm(r[partIdCol]),
				part_name:     norm(r[partNameCol]),
				mlm_id:        mlmIdCol !== -1 ? norm(r[mlmIdCol]) : '',
				material_desc: materialDescCol !== -1 ? norm(r[materialDescCol]) : '',
				supplier_name: supplierCol !== -1 ? norm(r[supplierCol]) : '',
				prod_uom:      prodUomCol !== -1 ? norm(r[prodUomCol]) : '',
				section:       currentSection,
				blockColors:   blocks.map((b) => norm(r[b.colorCol])),
			});
		}

		if (rawRows.length === 0) {
			throw new Error('Tidak ada baris data part yang terbaca dari file ini.');
		}

		const groupsByPartId = {};
		rawRows.forEach((r) => {
			if (!groupsByPartId[r.part_id]) groupsByPartId[r.part_id] = [];
			groupsByPartId[r.part_id].push(r);
		});

		const articles = articleSlots.map((s) => ({ article_id: s.article_id, parts: [] }));

		const toFields = (partId, nameRow, dataRow) => ({
			part_id: partId,
			part_name: nameRow.part_name || dataRow.part_name,
			mlm_id: dataRow.mlm_id,
			material_desc: dataRow.material_desc,
			supplier_name: dataRow.supplier_name,
			prod_uom: dataRow.prod_uom,
			section: dataRow.section,
		});

		Object.keys(groupsByPartId).forEach((partId) => {
			const group = groupsByPartId[partId];
			const nameSource = group.find((r) => r.part_name !== '') || group[0];

			if (group.length === 1) {
				const fields = toFields(partId, nameSource, group[0]);
				articleSlots.forEach((slot, slotIdx) => articles[slotIdx].parts.push(fields));
				return;
			}

			const hasAnyColor = group.some((r) => r.blockColors.some((c) => c !== ''));
			if (!hasAnyColor) {
				const fields = toFields(partId, nameSource, nameSource);
				articleSlots.forEach((slot, slotIdx) => articles[slotIdx].parts.push(fields));
				return;
			}

			articleSlots.forEach((slot, slotIdx) => {
				const blockIdx = blocks.indexOf(slot.block);
				const colorMatch = group.find((r) => r.blockColors[blockIdx] !== '');
				const dataRow = colorMatch || nameSource;   // fallback, tetap di-push
				articles[slotIdx].parts.push(toFields(partId, nameSource, dataRow));
			});
		});

		return {
			model_number: modelNumberFromFile,
			season: seasonFromFile,
			articles,
		};
	},

	async ingestModel(modelData) {
		const { model_number, season, articles } = modelData;

		if (!model_number) {
			showAlert("Model number kosong, tidak bisa lanjut ingest", "error");
			return;
		}
		if (!articles || articles.length === 0) {
			showAlert("Tidak ada artikel terbaca dari model ini", "warning");
			return;
		}

		const created = [];
		const skippedEmpty = [];
		const deltas = [];
		const errors = [];

		for (const art of articles) {
			const { article_id, parts } = art;

			if (!parts || parts.length === 0) {
				skippedEmpty.push(article_id);
				continue;
			}

			try {
				const existing = await checkExistingSession.run({ articleId: article_id });

				if (!existing || existing.length === 0) {
					await this.createNewSession(article_id, parts, null, model_number, null, season);
					created.push(article_id);
					continue;
				}

				const session = existing[0];
				const deltaResult = await getBOMDeltaIngest.run({
					sessionId: session.id,
					bomJson: JSON.stringify(parts)
				});
				const hasChanges = deltaResult.some((r) => r.delta_status !== 'SAME');

				if (!hasChanges) {
					skippedEmpty.push(article_id);
					continue;
				}

				const ingestMode = session.status === 'RELEASED' ? 'REVISION' : 'UPDATE';
				deltas.push({
					article_id,
					session_id: session.id,
					bomData: parts,
					deltaResult,
					ingestMode
				});
			} catch (e) {
				errors.push(article_id + ': ' + e.message);
			}
		}

		const activeSessions = await getAllActiveSessions.run();

		const currentModelArticles = (activeSessions || [])
		.filter((s) => s.model_number === model_number && s.season === season)
		.map((s) => s.article_id);
		const newFileArticleIds = articles.map((a) => a.article_id);
		const missingFromFile = currentModelArticles.filter(
			(a) => !newFileArticleIds.includes(a)
		);

		if (deltas.length > 0) {
			const combinedRows = deltas.flatMap((d) =>
																					d.deltaResult.map((r) => ({
				article_id: d.article_id,
				part_id: r.part_id,
				part_name: r.part_name,
				delta_status: r.delta_status,
				ingest_mode: d.ingestMode
			}))
																				 );

			const releasedSummary = deltas
			.filter((d) => d.ingestMode === 'REVISION')
			.map((d) => ({
				article_id: d.article_id,
				session_id: d.session_id,
				changed_parts: d.deltaResult.filter((r) => r.delta_status !== 'SAME').length
			}));

			storeValue('pendingModelIngest', {
				model_number,
				season,
				deltas: deltas.map((d) => ({
					article_id: d.article_id,
					session_id: d.session_id,
					bomData: d.bomData,
					ingestMode: d.ingestMode,
					deltaResult: d.deltaResult 
				})),
				combinedRows,
				releasedSummary
			});

			showModal('modal_confirmModelDelta');
		}

		let summary = 'Model ' + model_number + ': ' + created.length + ' artikel dibuat baru (' + created.join(', ') + ').';
		if (deltas.length > 0) {
			summary += ' ' + deltas.length + ' artikel punya perubahan BOM, menunggu konfirmasi di modal.';
		}
		if (skippedEmpty.length > 0) {
			summary += ' ' + skippedEmpty.length + ' artikel dilewati (BOM sudah up-to-date / tidak ada part).';
		}
		if (missingFromFile.length > 0) {
			summary += ' ℹ️ ' + missingFromFile.length + ' artikel model ini yang sebelumnya ada TIDAK ditemukan di file baru (tidak diubah/dihapus, cuma info): ' + missingFromFile.join(', ') + '.';
		}
		if (errors.length > 0) {
			summary += ' GAGAL: ' + errors.join('; ');
		}

		showAlert(summary, errors.length > 0 ? 'error' : (missingFromFile.length > 0 ? 'warning' : 'info'));

		return { created, skippedEmpty, deltas, errors, missingFromFile };
	},

	async onConfirmModelUpdate() {
		if (appsmith.store.currentUser?.role !== 'DEVELOPER') {
			showAlert("Hanya role Developer yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const pending = appsmith.store.pendingModelIngest;
		if (!pending) return;

		const selectedReleasedIds = (tbl_modelReleasedSelect.selectedRows || [])
		.map((r) => r.article_id);

		const updated = [];
		const revised = [];
		const skippedReleased = [];
		const errors = [];

		for (const d of pending.deltas) {
			try {
				if (d.ingestMode === 'REVISION') {
					if (!selectedReleasedIds.includes(d.article_id)) {
						skippedReleased.push(d.article_id);
						continue;
					}
					await this.createNewSession(d.article_id, d.bomData, d.session_id, pending.model_number, d.deltaResult, pending.season);
					revised.push(d.article_id);
				} else {
					await markRemovedParts.run({ sessionId: d.session_id, bomJson: JSON.stringify(d.bomData) });
					await insertNewParts.run({ sessionId: d.session_id, bomJson: JSON.stringify(d.bomData) });
					await setAffectedDivisionsRework.run({ sessionId: d.session_id });
					updated.push(d.article_id);
				}
			} catch (e) {
				errors.push(d.article_id + ': ' + e.message);
			}
		}

		await getAllActiveSessions.run();
		closeModal('modal_confirmModelDelta');
		storeValue('pendingModelIngest', null);

		let msg = '';
		if (updated.length > 0) msg += updated.length + ' artikel diupdate (' + updated.join(', ') + '). ';
		if (revised.length > 0) msg += revised.length + ' artikel dibuat revisi baru (' + revised.join(', ') + '). ';
		if (skippedReleased.length > 0) msg += skippedReleased.length + ' artikel RELEASED dilewati (tidak dicentang): ' + skippedReleased.join(', ') + '. ';
		if (errors.length > 0) msg += 'GAGAL: ' + errors.join('; ');

		showAlert(msg || 'Selesai.', errors.length > 0 ? 'error' : (skippedReleased.length > 0 ? 'warning' : 'success'));
	},


	async onIngestModel() {
		if (appsmith.store.currentUser?.role !== 'DEVELOPER') {
			showAlert("Hanya role Developer yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const modelName = inp_modelName.text.trim();
		if (!modelName) {
			showAlert("Masukkan Model Name terlebih dahulu", "warning");
			return;
		}
		if (!fp_modelExcel.files || fp_modelExcel.files.length === 0) {
			showAlert("Upload file Excel terlebih dahulu", "warning");
			return;
		}

		let modelData;
		try {
			modelData = await this.parseModelExcel(fp_modelExcel.files[0].data);
		} catch (e) {
			showAlert("Gagal parse Excel: " + e.message, "error");
			return;
		}

		try {
			await upsertModel.run({
				modelNumber: modelData.model_number,
				modelName:   modelName,
				season:      modelData.season
			});
		} catch (e) {
			showAlert("Gagal simpan info model: " + e.message, "error");
			return;
		}

		showAlert(
			"Model " + modelData.model_number + " (" + modelName + ", Season " + modelData.season +
			"): memproses " + modelData.articles.length + " artikel...",
			"info"
		);
		await this.ingestModel(modelData);
	},

	async openArticleDetailModal(sessionId, articleId) {
		if (!sessionId) return;
		await storeValue('showMainPartsOnly', false);
		await storeValue('activeModalSessionId', sessionId);
		await storeValue('activeModalArticleId', articleId);
		await getPartsForDetailModal.run({ sessionId });
		await getBlackboxCommerzCOSForModal.run({ sessionId });
		await getUTWIPForModal.run({ sessionId });
		await getBEWIPForModal.run({ sessionId });
		showModal('mdl_articleDetail');
	},

	walkWIPChain(partDbId, wipRows) {
		let current = wipRows.find(function (w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			return inputs.some(function (i) { return i.kind === 'PART' && i.ref === partDbId; });
		});
		if (!current) return [];
		const chain = [current];
		const visited = [current.id];
		while (true) {
			const parent = wipRows.find(function (w) {
				if (visited.indexOf(w.id) !== -1) return false;
				const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
				return inputs.some(function (i) { return i.kind === 'WIP' && i.ref === current.id; });
			});
			if (!parent) break;
			chain.push(parent);
			visited.push(parent.id);
			current = parent;
		}
		return chain;
	},

	buildWIPChainCell(partDbId, wipRows) {
		const chain = HomeJS.walkWIPChain(partDbId, wipRows);
		if (chain.length === 0) return '—';
		const ltFmt = function (v) {
			return (v === null || v === undefined || v === '') ? '—' : (v + ' hari');
		};
		if (chain.length === 1) {
			const w = chain[0];
			return w.label + '  ·  LT: ' + ltFmt(w.lead_time_days) + '  ·  Supplier: ' + (w.supplier_name || '—');
		}
		return chain.map(function (w, idx) {
			return (idx + 1) + '. ' + w.label + '  ·  LT: ' + ltFmt(w.lead_time_days) + '  ·  Supplier: ' + (w.supplier_name || '—');
		}).join('\n');
	},

	buildWIPChainLabel(partDbId, wipRows) {
		const chain = HomeJS.walkWIPChain(partDbId, wipRows);
		if (chain.length === 0) return '—';
		return chain.map(function (w) { return w.label; }).join(' → ');
	},

	utChainTotalLT(partDbId, wipRows) {
		const chain = HomeJS.walkWIPChain(partDbId, wipRows);
		if (chain.length === 0) return null;
		let total = 0, any = false;
		chain.forEach(function (w) {
			if (w.lead_time_days !== null && w.lead_time_days !== undefined) {
				total += Number(w.lead_time_days); any = true;
			}
		});
		return any ? total : null;
	},

	buildWIPChainSupplier(partDbId, wipRows) {
		const chain = HomeJS.walkWIPChain(partDbId, wipRows);
		if (chain.length === 0) return '—';
		const suppliers = chain.map(function (w) { return w.supplier_name || '—'; });
		const dedup = suppliers.filter(function (s, idx) { return idx === 0 || s !== suppliers[idx - 1]; });
		return dedup.join(' → ');
	},

	getArticleDetailRows() {
		const allParts = getPartsForDetailModal.data || [];
		const parts = (appsmith.store.showMainPartsOnly ?? false)
		? allParts.filter(function (p) { return p.part_id.indexOf('-') === -1; })
		: allParts;
		const bcc     = getBlackboxCommerzCOSForModal.data || [];
		const utWips  = getUTWIPForModal.data || [];
		const beWips  = getBEWIPForModal.data || [];

		const beStockfitting = beWips.filter(function (w) { return w.wip_type === 'SB'; });
		const beTreatment    = beWips.filter(function (w) { return w.wip_type === 'IS' && !w.is_sockliner_wip; });
		const beSockliner    = beWips.filter(function (w) { return w.is_sockliner_wip; });

		const cuttingLabel = function (t) {
			if (t === 'NORMAL') return 'Cutting Normal';
			if (t === 'INLINE') return 'Cutting Inline';
			if (t === 'BOOTIE') return 'Cutting Bootie';
			return null;
		};
		const cosTypeLabel = function (t) {
			if (t === 'CENTRAL') return 'Central';
			if (t === 'LINE') return 'Line';
			return null;
		};
		const lt = function (v) {
			return (v === null || v === undefined || v === '') ? '—' : (v + ' hari');
		};
		const pkg = function (no, type) {
			if (!no) return '—';
			const ct = cosTypeLabel(type);
			return 'Package ' + no + (ct ? ' — ' + ct : '');
		};
		const dash = function (v) { return (v === null || v === undefined || v === '') ? '—' : v; };

		const buildUtCell = function (partDbId) {
			const label = HomeJS.buildWIPChainLabel(partDbId, utWips);
			if (label === '—') return '—';
			const ltVal = lt(HomeJS.utChainTotalLT(partDbId, utWips));
			const supplier = HomeJS.buildWIPChainSupplier(partDbId, utWips);
			return label + '\nLT: ' + ltVal + '  ·  Supplier: ' + supplier;
		};

		return parts.map(function (p) {
			const bc = bcc.find(function (x) { return x.part_id === p.part_id; }) || {};

			const cmzCut = cuttingLabel(bc.cutting_type);
			const commerz = cmzCut
			? (cmzCut + (bc.cutting_process_name ? ' — ' + bc.cutting_process_name : ''))
			: '—';

			let sockliner = '—';
			if (p.is_sockliner) {
				sockliner = p.is_bought_ready ? 'Beli Jadi' : HomeJS.buildWIPChainCell(p.id, beSockliner);
			}

			return {
				part_id:           p.part_id,
				part_name:         p.part_name,
				material:          dash(p.material_desc),
				bb_machine:        dash(bc.laminating_machine),
				bb_lt:             lt(bc.lam_lead_time_days),
				cmz_cutting:       commerz,
				cmz_lt:            lt(bc.cutting_lead_time_days),
				cos_before_pkg:    pkg(bc.before_package_no, bc.before_cos_type),
				cos_before_lt:     lt(bc.before_lead_time_days),
				cos_before_remark: dash(bc.cos_remark_before),
				ut_pkg:            HomeJS.buildWIPChainCell(p.id, utWips),
				cos_after_pkg:     pkg(bc.after_package_no, bc.after_cos_type),
				cos_after_lt:      lt(bc.after_lead_time_days),
				cos_after_remark:  dash(bc.cos_remark_after),
				outsole_pkg:       HomeJS.buildWIPChainCell(p.id, beTreatment),
				stockfitting_pkg:  HomeJS.buildWIPChainCell(p.id, beStockfitting),
				sockliner_pkg:     sockliner
			};
		});
	},

	onToggleMainPartsOnly: async function () {
		const current = appsmith.store.showMainPartsOnly ?? false;
		await storeValue('showMainPartsOnly', !current);
	},

	getMainPartsToggleLabel: function () {
		return (appsmith.store.showMainPartsOnly ?? false) ? 'Tampilkan Semua Part' : 'Tampilkan Part Utama Saja';
	},

	onForceResyncPartInfo: async function () {
		if (appsmith.store.currentUser?.role !== 'DEVELOPER') {
			showAlert('Hanya DEVELOPER yang bisa melakukan resync.', 'warning');
			return;
		}
		if (!fp_modelExcel.files || fp_modelExcel.files.length === 0) {
			showAlert('Upload file Excel terlebih dahulu', 'warning');
			return;
		}

		let modelData;
		try {
			modelData = await this.parseModelExcel(fp_modelExcel.files[0].data);
		} catch (e) {
			showAlert('Gagal parse Excel: ' + e.message, 'error');
			return;
		}

		console.log('storeArticleId:', appsmith.store.activeModalArticleId);
		console.log('fileArticleIds:', modelData.articles.map((a) => a.article_id));

		const article = modelData.articles.find((a) => a.article_id === appsmith.store.activeModalArticleId);
		if (!article) {
			showAlert('Artikel ini tidak ditemukan di file yang di-upload.', 'error');
			return;
		}

		try {
			await syncPartFieldsOnly.run({
				sessionId: appsmith.store.activeModalSessionId,
				bomJson: JSON.stringify(article.parts)
			});
		} catch (e) {
			showAlert('Gagal resync: ' + e.message, 'error');
			return;
		}

		await getPartsForDetailModal.run({ sessionId: appsmith.store.activeModalSessionId });
		await getBlackboxCommerzCOSForModal.run({ sessionId: appsmith.store.activeModalSessionId });
		await getAllActiveSessions.run();

		showAlert('Info part berhasil di-resync.', 'success');
	},

}