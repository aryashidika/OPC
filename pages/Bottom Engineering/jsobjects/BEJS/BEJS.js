export default {

	_submitConfirmed: false,
	_editWipId: null,
	_editWipType: null,
	_pendingAdd: [],
	_pendingRemove: [],
	_pendingBoughtReady: {},

	_sockEditWipId: null,
	_sockPendingAdd: [],
	_sockPendingRemove: [],

	onPageLoad: async function () {
		if (!AuthJS.checkAuthGuard(null, 'PRB')) return;

		BEJS._editWipId = null;
		BEJS._editWipType = null;
		BEJS._pendingAdd = [];
		BEJS._pendingRemove = [];
		BEJS._pendingBoughtReady = {};
		BEJS._sockEditWipId = null;
		BEJS._sockPendingAdd = [];
		BEJS._sockPendingRemove = [];
		await storeValue('beEditWipId', 0);
		await storeValue('sockEditWipId', 0);
		await storeValue('beCheckedWipIds', []);
		await getOutsoleSupplierMaster.run();
		await getSocklinerSupplierMaster.run();
		await getArticleList.run();
		const articleFromUrl = appsmith.URL.queryParams.article_id;
		if (articleFromUrl) {
			await storeValue('activeArticleId', articleFromUrl);
			await resetWidget('sel_article');
			storeValue('_trigger', Date.now());
			await BEJS.onArticleSelect();
		}
	},

	getSessionId: function () {
		return getDivisionStatus.data[0]?.session_id;
	},

	getBEStatus: function () {
		const statuses = getDivisionStatus.data;
		if (!statuses || statuses.length === 0) return 'NOT_STARTED';
		const be = statuses.find(function (s) {
			return s.division === 'BOTTOM_ENGINEERING';
		});
		return be ? be.state : 'NOT_STARTED';
	},

	isLocked: function () {
		return BEJS.getBEStatus() === 'SUBMITTED';
	},

	hasSB: function () {
		const wips = getWIPListBE.data || [];
		return wips.some(function (w) { return w.wip_type === 'SB'; });
	},

	getBottomMissing: function () {
		const outsole = BEJS.getWIPDisplay().filter(function (w) { return !w.is_sockliner_wip; });
		const missing = [];
		if (!outsole.some(function (w) { return w.wip_type === 'SB'; })) missing.push('Stockfitting');
		if (!outsole.some(function (w) { return w.wip_type === 'IS'; })) missing.push('Treatment Outsole');
		return missing;
	},

	onArticleSelect: async function () {
		if (!sel_article.selectedOptionValue) return;
		BEJS._editWipId = null;
		BEJS._editWipType = null;
		BEJS._pendingAdd = [];
		BEJS._pendingRemove = [];
		BEJS._pendingBoughtReady = {};
		BEJS._sockEditWipId = null;
		BEJS._sockPendingAdd = [];
		BEJS._sockPendingRemove = [];
		BEJS._submitConfirmed = false;
		await storeValue('beEditWipId', 0);
		await storeValue('sockEditWipId', 0);
		await storeValue('beCheckedWipIds', []);
		await Promise.all([
			getModelInfoForArticle.run(),
			getDivisionStatus.run(),
			getPartsForBE.run(),
			getWIPListBE.run(),
			getAvailablePoolBE.run(),
			getPartsForSockliner.run(),
			getWIPListSockliner.run(),
			getAvailablePoolSockliner.run()
		]);
	},

	onSubmit: async function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert('Sudah submitted.', 'warning');
			return;
		}

		const wipDisplay = BEJS.getWIPDisplay();
		const emptyWIPs = wipDisplay.filter(function (w) { return w.is_empty && !w.is_sockliner_wip; });
		if (emptyWIPs.length > 0) {
			showAlert(
				'Package Outsole berikut tidak punya raw part: ' +
				emptyWIPs.map(function (w) { return w.label; }).join(', ') +
				'. Hapus atau assign input dulu.',
				'warning'
			);
			return;
		}

		const sockDisplay = BEJS.getSockWIPDisplay();
		const emptySockWIPs = sockDisplay.filter(function (w) { return w.is_empty && w.is_sockliner_wip; });
		if (emptySockWIPs.length > 0) {
			showAlert(
				'Package Sockliner berikut tidak punya raw part: ' +
				emptySockWIPs.map(function (w) { return w.label; }).join(', ') +
				'. Hapus atau assign input dulu.',
				'warning'
			);
			return;
		}

		const missing = BEJS.getBottomMissing();
		if (missing.length > 0 && !BEJS._submitConfirmed) {
			await storeValue('beMissingText', missing.join(' dan '));
			showModal('mdl_confirmSubmitBE');
			return;
		}
		BEJS._submitConfirmed = false;

		try {
			await submitDivision.run({
				sessionId: BEJS.getSessionId(),
				division: 'BOTTOM_ENGINEERING',
				state: 'SUBMITTED',
				submittedBy: appsmith.user.email
			});
			await getDivisionStatus.run();
			await getRevisionArticles.run();
			showAlert('Bottom Engineering submitted!', 'success');
		} catch (e) {
			showAlert('Gagal submit: ' + e.message, 'error');
		}
	},

	onConfirmSubmitBE: async function () {
		BEJS._submitConfirmed = true;
		closeModal('mdl_confirmSubmitBE');
		await BEJS.onSubmit();
	},

	onCancelSubmitBE: function () {
		BEJS._submitConfirmed = false;
		closeModal('mdl_confirmSubmitBE');
	},

	isEditMode: function () {
		return BEJS._editWipId !== null || BEJS._editWipType !== null;
	},

	getFormLabel: function () {
		if (BEJS._editWipId !== null) return 'Simpan Perubahan';
		if (BEJS._editWipType === 'SB') return 'Buat Stockfitting';
		if (BEJS._editWipType === 'IS') return 'Buat Treatment';
		return 'Simpan';
	},

	onStartCreate: async function (wipType) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		if (wipType === 'SB' && BEJS.hasSB()) {
			showAlert("Hanya boleh satu Stockfitting (SB) per artikel.", "warning");
			return;
		}
		BEJS._editWipId = null;
		BEJS._editWipType = wipType;
		BEJS._pendingAdd = [];
		BEJS._pendingRemove = [];
		await storeValue('beEditWipId', 0);
		await storeValue('beEditWipLabel', '');
		await storeValue('beEditWipSupplierId', '');
		await storeValue('beEditWipType', wipType);
		resetWidget('inp_beLabel');
		resetWidget('sel_beSupplier');
		resetWidget('inp_beLeadTime');
		await getAvailablePoolBE.run();
	},

	onToggleBoughtReady: async function (partDbId, currentValue) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		const sid = BEJS.getSessionId();
		try {
			await toggleBoughtReady.run({
				partId: partDbId,
				sessionId: sid,
				isBoughtReady: !currentValue
			});
			await getPartsForBE.run();
			await getAvailablePoolBE.run();
		} catch (e) {
			showAlert("Error: " + e.message, "error");
		}
	},

	getWIPDisplay: function () {
		const wips = getWIPListBE.data || [];
		const checked = appsmith.store.beCheckedWipIds || [];
		return wips.map(function (w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			const inputLabels = inputs.map(function (i) { return i.label + ' (' + (i.kind === 'WIP' ? 'Package' : i.kind) + ')'; }).join(', ');

			const stack = [w.id];
			const visited = [];
			const allWips = getWIPListBE.data || [];
			let hasRawPart = false;

			while (stack.length > 0) {
				const currentId = stack.pop();
				if (visited.indexOf(currentId) !== -1) continue;
				visited.push(currentId);
				const currentWip = allWips.find(function (x) { return x.id === currentId; });
				if (!currentWip) continue;
				const wipInputs = typeof currentWip.inputs === 'string'
				? JSON.parse(currentWip.inputs)
				: currentWip.inputs;
				wipInputs.forEach(function (i) {
					if (i.kind === 'PART') hasRawPart = true;
					else if (i.kind === 'WIP') stack.push(i.ref);
				});
			}

			return {
				id: w.id,
				is_sockliner_wip: w.is_sockliner_wip,
				category: w.category,
				label: w.label,
				supplier_id: w.supplier_id,               
				supplier_name: w.supplier_name || '-',
				wip_type: w.wip_type,                      
				lead_time_days: w.lead_time_days !== null && w.lead_time_days !== undefined ? w.lead_time_days : '-',
				inputs_label: inputLabels || '-',
				is_empty: !hasRawPart,
				copied_from_article_id: w.copied_from_article_id || null,
			};
		});
	},

	onSelectWIP: async function () {
		if (BEJS.isLocked()) return;
		const selected = tbl_WIPListBE.selectedRow;
		if (!selected || !selected.id) {
			await BEJS.onCancelEdit();
			return;
		}
		if (selected.is_sockliner_wip) {
			showAlert("Package Sockliner hanya bisa diedit di tab Sockliner.", "warning");
			await BEJS.onCancelEdit();
			return;
		}
		BEJS._editWipId = selected.id;
		BEJS._editWipType = selected.wip_type;
		BEJS._pendingAdd = [];
		BEJS._pendingRemove = [];
		await storeValue('beEditWipId', selected.id);
		await storeValue('beEditWipLabel', selected.label);
		await storeValue('beEditWipSupplierId', selected.supplier_id ? parseInt(selected.supplier_id) : '');
		await storeValue('beEditWipType', selected.wip_type);
		await storeValue('beEditWipLeadTime', selected.lead_time_days !== '-' ? selected.lead_time_days : '');
		resetWidget('inp_beLabelEdit');
		resetWidget('sel_beSupplierEdit');
		resetWidget('inp_beLeadTimeEdit');
		await getAvailablePoolBE.run();
	},

	onCancelEdit: async function () {
		BEJS._editWipId = null;
		BEJS._editWipType = null;
		BEJS._pendingAdd = [];
		BEJS._pendingRemove = [];
		await storeValue('beEditWipId', 0);
		await storeValue('beEditWipLabel', '');
		await storeValue('beEditWipSupplierId', '');
		await storeValue('beEditWipType', '');
		await storeValue('beEditWipLeadTime', '');
		resetWidget('inp_beLabelEdit');
		resetWidget('sel_beSupplierEdit');
		resetWidget('inp_beLeadTimeEdit');
	},

	getPoolData: function () {
		const pool = getAvailablePoolBE.data || [];
		const parts = getPartsForBE.data || [];

		let available = pool
		.filter(function (p) { return !p.is_current_wip; })
		.map(function (p) {
			const part = p.kind === 'PART'
			? parts.find(function (pt) { return pt.id === p.ref; })
			: null;
			return {
				kind: p.kind,
				ref: p.ref,
				label: p.label,
				part_no: part ? part.part_id : '-'
			};
		});

		BEJS._pendingRemove.forEach(function (item) {
			const alreadyIn = available.some(function (a) {
				return a.kind === item.kind && a.ref === item.ref;
			});
			if (!alreadyIn) available.push(item);
		});

		available = available.filter(function (a) {
			return !BEJS._pendingAdd.some(function (add) {
				return add.kind === a.kind && a.ref === add.ref;
			});
		});

		return available;
	},

	getCurrentInputs: function () {
		if (!BEJS._editWipId) return [];
		const wips = getWIPListBE.data || [];
		const parts = getPartsForBE.data || [];
		const wip = wips.find(function (w) { return w.id === BEJS._editWipId; });
		if (!wip) return [];

		const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
		let current = inputs.map(function (i) {
			const part = i.kind === 'PART'
			? parts.find(function (pt) { return pt.id === i.ref; })
			: null;
			return {
				kind: i.kind,
				ref: i.ref,
				label: i.label || (i.kind === 'WIP' ? 'Package' : i.kind) + ':' + i.ref,
				part_no: part ? part.part_id : '-'
			};
		});

		BEJS._pendingAdd.forEach(function (item) {
			const alreadyIn = current.some(function (c) {
				return c.kind === item.kind && c.ref === item.ref;
			});
			if (!alreadyIn) {
				const part = item.kind === 'PART'
				? parts.find(function (pt) { return pt.id === item.ref; })
				: null;
				current.push({
					kind: item.kind,
					ref: item.ref,
					label: item.label,
					part_no: part ? part.part_id : '-'
				});
			}
		});

		current = current.filter(function (c) {
			return !BEJS._pendingRemove.some(function (r) {
				return r.kind === c.kind && r.ref === c.ref;
			});
		});

		return current;
	},

	onMoveToPool: function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') return;
		if (BEJS.isLocked()) return;
		const selectedRows = tbl_currentInputsBE.selectedRows.filter(function (row) {
			return row && row.kind && row.ref !== undefined && row.ref !== null;
		});
		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 item.", "warning");
			return;
		}
		selectedRows.forEach(function (row) {
			const pendingAddIdx = BEJS._pendingAdd.findIndex(function (a) {
				return a.kind === row.kind && a.ref === row.ref;
			});
			if (pendingAddIdx !== -1) {
				BEJS._pendingAdd.splice(pendingAddIdx, 1);
			} else {
				const alreadyRemove = BEJS._pendingRemove.some(function (r) {
					return r.kind === row.kind && r.ref === row.ref;
				});
				if (!alreadyRemove) {
					BEJS._pendingRemove.push({ kind: row.kind, ref: row.ref, label: row.label });
				}
			}
		});
		showAlert(selectedRows.length + " item ditandai untuk dihapus.", "info");
	},

	onMoveToInputs: function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') return;
		if (BEJS.isLocked()) return;
		const selectedRows = tbl_availablePoolBE.selectedRows.filter(function (row) {
			return row && row.kind && row.ref !== undefined && row.ref !== null;
		});
		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 item dari pool.", "warning");
			return;
		}
		selectedRows.forEach(function (row) {
			const pendingRemoveIdx = BEJS._pendingRemove.findIndex(function (r) {
				return r.kind === row.kind && r.ref === row.ref;
			});
			if (pendingRemoveIdx !== -1) {
				BEJS._pendingRemove.splice(pendingRemoveIdx, 1);
			} else {
				const alreadyAdd = BEJS._pendingAdd.some(function (a) {
					return a.kind === row.kind && a.ref === row.ref;
				});
				if (!alreadyAdd) {
					BEJS._pendingAdd.push({ kind: row.kind, ref: row.ref, label: row.label });
				}
			}
		});
		showAlert(selectedRows.length + " item ditandai untuk ditambah.", "info");
	},

	onCreateOrUpdateWIP: async function (wipType) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const isCreateMode = wipType !== undefined && wipType !== null;
		const label = isCreateMode ? inp_beLabel.text.trim() : inp_beLabelEdit.text.trim();

		if (!label) {
			showAlert("Label wajib diisi.", "warning");
			return;
		}

		const sid = BEJS.getSessionId();
		const wt = wipType || BEJS._editWipType;
		const supplierId = isCreateMode
		? sel_beSupplier.selectedOptionValue
		: sel_beSupplierEdit.selectedOptionValue;
		const supplierParam = (supplierId === undefined || supplierId === null || supplierId === '')
		? 'NULL' : String(supplierId);
		const rawLT = isCreateMode ? inp_beLeadTime.text : inp_beLeadTimeEdit.text;
		const leadTimeDays = (rawLT !== null && rawLT !== "" && rawLT !== undefined)
		? rawLT.toString() : '';

		try {
			if (!isCreateMode && BEJS._editWipId !== null) {
				await updateBottomWIP.run({
					wipId: BEJS._editWipId,
					sessionId: sid,
					label: label,
					supplierId: supplierParam,
					leadTimeDays: leadTimeDays
				});

				if (BEJS._pendingRemove.length > 0) {
					await Promise.all(BEJS._pendingRemove.map(function (item) {
						return deleteBottomWIPInput.run({
							wipId: BEJS._editWipId,
							inputKind: item.kind,
							inputRef: item.ref
						});
					}));
				}

				if (BEJS._pendingAdd.length > 0) {
					await Promise.all(BEJS._pendingAdd.map(function (item) {
						return addBottomWIPInput.run({
							wipId: BEJS._editWipId,
							inputKind: item.kind,
							inputRef: item.ref
						});
					}));
				}

				showAlert("Package berhasil diupdate.", "success");

			} else {
				if (wt === 'SB' && BEJS.hasSB()) {
					showAlert("Hanya boleh satu Stockfitting (SB) per artikel.", "warning");
					return;
				}

				const result = await createBottomWIP.run({
					sessionId: sid,
					wipType: wt,
					label: label,
					supplierId: supplierParam,
					leadTimeDays: leadTimeDays,
					createdBy: appsmith.user.email,
					isSocklinerWip: false
				});

				const newWipId = result[0].id;

				if (BEJS._pendingAdd.length > 0) {
					await Promise.all(BEJS._pendingAdd.map(function (item) {
						return addBottomWIPInput.run({
							wipId: newWipId,
							inputKind: item.kind,
							inputRef: item.ref
						});
					}));
				}

				showAlert(wt + " berhasil dibuat.", "success");
			}

			if (BEJS.getBEStatus() === 'NOT_STARTED') {
				await submitDivision.run({
					sessionId: sid,
					division: 'BOTTOM_ENGINEERING',
					state: 'IN_WORK',
					submittedBy: appsmith.user.email
				});
			}

			if (isCreateMode) {
				resetWidget('inp_beLabel');
				resetWidget('sel_beSupplier');
				resetWidget('inp_beLeadTime');
				BEJS._editWipType = null;
				BEJS._pendingAdd = [];
				BEJS._pendingRemove = [];
			} else {
				BEJS._editWipId = null;
				BEJS._editWipType = null;
				BEJS._pendingAdd = [];
				BEJS._pendingRemove = [];
				await storeValue('beEditWipId', 0);
				await storeValue('beEditWipLabel', '');
				await storeValue('beEditWipSupplierId', '');
				await storeValue('beEditWipType', '');
				await storeValue('beEditWipLeadTime', '');
				resetWidget('inp_beLabelEdit');
				resetWidget('sel_beSupplierEdit');
				resetWidget('inp_beLeadTimeEdit');
			}

			await getWIPListBE.run();
			await getAvailablePoolBE.run();
			await getPartsForBE.run();
			await getDivisionStatus.run();

		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

	onDeleteWIP: async function (wipId) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		if (BEJS._editWipId === wipId) {
			await BEJS.onCancelEdit();
		}
		try {
			await deleteBottomWIP.run({
				wipId: wipId,
				sessionId: BEJS.getSessionId()
			});
			await getWIPListBE.run();
			await getAvailablePoolBE.run();
			await getPartsForBE.run();
			showAlert("Package dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	isSockEditMode: function () {
		return BEJS._sockEditWipId !== null;
	},

	getSockFormLabel: function () {
		return BEJS._sockEditWipId !== null ? 'Simpan Perubahan' : 'Buat Package';
	},

	onSockToggleBoughtReady: async function (partDbId, currentValue) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		const sid = BEJS.getSessionId();
		const turningOn = !currentValue;
		try {
			if (turningOn) {
				const partRow = (getPartsForSockliner.data || []).find(function (p) { return p.id === partDbId; });
				if (partRow && partRow.bottom_wip_id) {
					await deleteBottomWIPInput.run({ wipId: partRow.bottom_wip_id, inputKind: 'PART', inputRef: partDbId });
				}
			}
			await toggleBoughtReady.run({ partId: partDbId, sessionId: sid, isBoughtReady: turningOn });

			await getPartsForSockliner.run();
			await getAvailablePoolSockliner.run();
			await getWIPListSockliner.run();
		} catch (e) {
			showAlert("Error: " + e.message, "error");
		}
	},

	getSockWIPDisplay: function () {
		const wips = getWIPListSockliner.data || [];
		const checked = appsmith.store.beCheckedWipIds || [];
		return wips.map(function (w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			const inputLabels = inputs.map(function (i) { return i.label + ' (' + (i.kind === 'WIP' ? 'Package' : i.kind) + ')'; }).join(', ');

			const stack = [w.id];
			const visited = [];
			let hasRawPart = false;

			while (stack.length > 0) {
				const currentId = stack.pop();
				if (visited.indexOf(currentId) !== -1) continue;
				visited.push(currentId);
				const currentWip = wips.find(function (x) { return x.id === currentId; });
				if (!currentWip) continue;
				const wipInputs = typeof currentWip.inputs === 'string'
				? JSON.parse(currentWip.inputs) : currentWip.inputs;
				wipInputs.forEach(function (i) {
					if (i.kind === 'PART') hasRawPart = true;
					else if (i.kind === 'WIP') stack.push(i.ref);
				});
			}

			return {
				id: w.id,
				is_sockliner_wip: w.is_sockliner_wip,
				category: w.category,
				wip_type: w.wip_type,
				label: w.label,
				supplier_id: w.supplier_id || '',
				supplier_name: w.supplier_name || '-',
				lead_time_days: w.lead_time_days !== null && w.lead_time_days !== undefined
				? w.lead_time_days : '-',
				inputs_label: inputLabels || '-',
				is_empty: !hasRawPart,
				copied_from_article_id: w.copied_from_article_id || null,
			};
		});
	},

	onSockSelectWIP: async function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') return;
		if (BEJS.isLocked()) return;
		const selected = tbl_WIPListSockliner.selectedRow;
		if (!selected || !selected.id) {
			await BEJS.onSockCancelEdit();
			return;
		}
		if (!selected.is_sockliner_wip) {
			showAlert("Package Outsole hanya bisa diedit di tab Bottom.", "warning");
			await BEJS.onSockCancelEdit();
			return;
		}
		BEJS._sockEditWipId = selected.id;
		BEJS._sockPendingAdd = [];
		BEJS._sockPendingRemove = [];
		await storeValue('sockEditWipId', selected.id);
		await storeValue('sockEditWipLabel', selected.label);
		await storeValue('sockEditWipSupplierId', selected.supplier_id ? parseInt(selected.supplier_id) : '');
		await storeValue('sockEditWipLeadTime', selected.lead_time_days !== '-' ? selected.lead_time_days : '');

		resetWidget('inp_sockLabelEdit');
		resetWidget('sel_sockSupplierEdit');
		resetWidget('inp_sockLeadTimeEdit');
		await getAvailablePoolSockliner.run();
	},

	onSockCancelEdit: async function () {
		BEJS._sockEditWipId = null;
		BEJS._sockPendingAdd = [];
		BEJS._sockPendingRemove = [];
		await storeValue('sockEditWipId', 0);
		await storeValue('sockEditWipLabel', '');
		await storeValue('sockEditWipSupplierId', '');
		await storeValue('sockEditWipLeadTime', '');
		resetWidget('inp_sockLabelEdit');
		resetWidget('sel_sockSupplierEdit');
		resetWidget('inp_sockLeadTimeEdit');
	},

	getSockPoolData: function () {
		const pool = getAvailablePoolSockliner.data || [];
		const parts = getPartsForSockliner.data || [];

		let available = pool
		.filter(function (p) { return !p.is_current_wip; })
		.map(function (p) {
			const part = p.kind === 'PART'
			? parts.find(function (pt) { return pt.id === p.ref; })
			: null;
			return {
				kind: p.kind,
				ref: p.ref,
				label: p.label,
				part_no: part ? part.part_id : '-'
			};
		});

		BEJS._sockPendingRemove.forEach(function (item) {
			const alreadyIn = available.some(function (a) {
				return a.kind === item.kind && a.ref === item.ref;
			});
			if (!alreadyIn) available.push(item);
		});

		available = available.filter(function (a) {
			return !BEJS._sockPendingAdd.some(function (add) {
				return add.kind === a.kind && a.ref === add.ref;
			});
		});

		return available;
	},

	getSockCurrentInputs: function () {
		if (!BEJS._sockEditWipId) return [];
		const wips = getWIPListSockliner.data || [];
		const parts = getPartsForSockliner.data || [];
		const wip = wips.find(function (w) { return w.id === BEJS._sockEditWipId; });
		if (!wip) return [];

		const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
		let current = inputs.map(function (i) {
			const part = i.kind === 'PART'
			? parts.find(function (pt) { return pt.id === i.ref; })
			: null;
			return {
				kind: i.kind,
				ref: i.ref,
				label: i.label || (i.kind === 'WIP' ? 'Package' : i.kind) + ':' + i.ref,
				part_no: part ? part.part_id : '-'
			};
		});

		BEJS._sockPendingAdd.forEach(function (item) {
			const alreadyIn = current.some(function (c) {
				return c.kind === item.kind && c.ref === item.ref;
			});
			if (!alreadyIn) {
				const part = item.kind === 'PART'
				? parts.find(function (pt) { return pt.id === item.ref; })
				: null;
				current.push({
					kind: item.kind,
					ref: item.ref,
					label: item.label,
					part_no: part ? part.part_id : '-'
				});
			}
		});

		current = current.filter(function (c) {
			return !BEJS._sockPendingRemove.some(function (r) {
				return r.kind === c.kind && r.ref === c.ref;
			});
		});

		return current;
	},

	onSockMoveToInputs: function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') return;
		if (BEJS.isLocked()) return;
		const selectedRows = tbl_availablePoolSockliner.selectedRows.filter(function (row) {
			return row && row.kind && row.ref !== undefined && row.ref !== null;
		});
		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 item dari pool.", "warning");
			return;
		}
		selectedRows.forEach(function (row) {
			const pendingRemoveIdx = BEJS._sockPendingRemove.findIndex(function (r) {
				return r.kind === row.kind && r.ref === row.ref;
			});
			if (pendingRemoveIdx !== -1) {
				BEJS._sockPendingRemove.splice(pendingRemoveIdx, 1);
			} else {
				const alreadyAdd = BEJS._sockPendingAdd.some(function (a) {
					return a.kind === row.kind && a.ref === row.ref;
				});
				if (!alreadyAdd) {
					BEJS._sockPendingAdd.push({ kind: row.kind, ref: row.ref, label: row.label });
				}
			}
		});
		showAlert(selectedRows.length + " item ditandai untuk ditambah.", "info");
	},

	onSockMoveToPool: function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') return;
		if (BEJS.isLocked()) return;
		const selectedRows = tbl_currentInputsSockliner.selectedRows.filter(function (row) {
			return row && row.kind && row.ref !== undefined && row.ref !== null;
		});
		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 item.", "warning");
			return;
		}
		selectedRows.forEach(function (row) {
			const pendingAddIdx = BEJS._sockPendingAdd.findIndex(function (a) {
				return a.kind === row.kind && a.ref === row.ref;
			});
			if (pendingAddIdx !== -1) {
				BEJS._sockPendingAdd.splice(pendingAddIdx, 1);
			} else {
				const alreadyRemove = BEJS._sockPendingRemove.some(function (r) {
					return r.kind === row.kind && r.ref === row.ref;
				});
				if (!alreadyRemove) {
					BEJS._sockPendingRemove.push({ kind: row.kind, ref: row.ref, label: row.label });
				}
			}
		});
		showAlert(selectedRows.length + " item ditandai untuk dihapus.", "info");
	},

	onSockCreateOrUpdate: async function (isCreate) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const sid = BEJS.getSessionId();
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const label = isCreate ? inp_sockLabel.text.trim() : inp_sockLabelEdit.text.trim();
		if (!label) {
			showAlert("Label wajib diisi.", "warning");
			return;
		}

		const supplierId = isCreate
		? sel_sockSupplier.selectedOptionValue
		: sel_sockSupplierEdit.selectedOptionValue;
		const supplierParam = (supplierId === undefined || supplierId === null || supplierId === '')
		? 'NULL' : String(supplierId);
		const rawLT = isCreate ? inp_sockLeadTime.text : inp_sockLeadTimeEdit.text;
		const leadTimeDays = (rawLT !== null && rawLT !== "" && rawLT !== undefined) ? rawLT.toString() : '';

		try {
			if (!isCreate && BEJS._sockEditWipId !== null) {
				// ── Edit mode ──
				await updateBottomWIP.run({
					wipId: BEJS._sockEditWipId, sessionId: sid, label: label,
					supplierId: supplierParam, leadTimeDays: leadTimeDays
				});

				const removedPartIds = BEJS._sockPendingRemove
				.filter(function (i) { return i.kind === 'PART'; })
				.map(function (i) { return i.ref; });
				if (removedPartIds.length > 0) {
					await setSocklinerFlag.run({
						partIds: JSON.stringify(removedPartIds), isSockliner: false, sessionId: sid
					});
					await Promise.all(BEJS._sockPendingRemove.map(function (item) {
						return deleteBottomWIPInput.run({
							wipId: BEJS._sockEditWipId, inputKind: item.kind, inputRef: item.ref
						});
					}));
				}

				const addedPartIds = BEJS._sockPendingAdd
				.filter(function (i) { return i.kind === 'PART'; })
				.map(function (i) { return i.ref; });
				if (addedPartIds.length > 0) {
					await setSocklinerFlag.run({
						partIds: JSON.stringify(addedPartIds), isSockliner: true, sessionId: sid
					});
					await Promise.all(BEJS._sockPendingAdd.map(function (item) {
						return addBottomWIPInput.run({
							wipId: BEJS._sockEditWipId, inputKind: item.kind, inputRef: item.ref
						});
					}));
				}

				showAlert("Package Sockliner berhasil diupdate.", "success");

			} else {
				const result = await createBottomWIP.run({
					sessionId: sid,
					wipType: 'ZSS',        
					label: label,
					supplierId: supplierParam,
					leadTimeDays: leadTimeDays,
					createdBy: appsmith.user.email,
					isSocklinerWip: true
				});

				const newWipId = result[0].id;
				const addedPartIds = BEJS._sockPendingAdd
				.filter(function (i) { return i.kind === 'PART'; })
				.map(function (i) { return i.ref; });
				if (addedPartIds.length > 0) {
					await setSocklinerFlag.run({ partIds: addedPartIds.join(','), isSockliner: true, sessionId: sid });
				}
				if (BEJS._sockPendingAdd.length > 0) {
					await Promise.all(BEJS._sockPendingAdd.map(function (item) {
						return addBottomWIPInput.run({ wipId: newWipId, inputKind: item.kind, inputRef: item.ref });
					}));
				}

				showAlert("Package Sockliner berhasil dibuat.", "success");
			}

			if (BEJS.getBEStatus() === 'NOT_STARTED') {
				await submitDivision.run({
					sessionId: sid, division: 'BOTTOM_ENGINEERING', state: 'IN_WORK', submittedBy: appsmith.user.email
				});
			}

			if (isCreate) {
				resetWidget('inp_sockLabel');
				resetWidget('sel_sockSupplier');
				resetWidget('inp_sockLeadTime');
				BEJS._sockPendingAdd = [];
				BEJS._sockPendingRemove = [];
			} else {
				await BEJS.onSockCancelEdit();
			}

			await getWIPListSockliner.run();
			await getAvailablePoolSockliner.run();
			await getPartsForSockliner.run();
			await getDivisionStatus.run();
			storeValue('_trigger', Date.now());

		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

	onSockDeleteWIP: async function (wipId) {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BEJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const wips = getWIPListSockliner.data || [];
		const wip = wips.find(function (w) { return w.id === wipId; });
		if (wip) {
			const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
			const partIds = inputs
			.filter(function (i) { return i.kind === 'PART'; })
			.map(function (i) { return i.ref; });

			if (partIds.length > 0) {
				try {
					await setSocklinerFlag.run({
						partIds: JSON.stringify(partIds),
						isSockliner: false,
						sessionId: BEJS.getSessionId()
					});
				} catch (e) {
					showAlert("Gagal unset sockliner flag: " + e.message, "error");
					return;
				}
			}
		}

		if (BEJS._sockEditWipId === wipId) {
			await BEJS.onSockCancelEdit();
		}

		try {
			await deleteBottomWIP.run({ wipId: wipId, sessionId: BEJS.getSessionId() });
			await getWIPListSockliner.run();
			await getAvailablePoolSockliner.run();
			await getPartsForSockliner.run();
			showAlert("Package Sockliner dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	onCloseAllConcernsBE: async function () {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const concerns = getOpenConcernsForBE.data || [];
		if (concerns.length === 0) {
			showAlert("Tidak ada concern terbuka.", "info");
			return;
		}
		try {
			await Promise.all(concerns.map(function (c) {
				return closeConcernBE.run({ concernId: c.id, closedBy: appsmith.user.email });
			}));
			await getOpenConcernsForBE.run();
			await getRevisionArticles.run();
			showAlert("Semua concern ditutup.", "success");
		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

	async onCopyDivisionConfig() {
		if (appsmith.store.currentUser?.role !== 'BOTTOM_ENGINEERING') {
			showAlert("Hanya role BOTTOM_ENGINEERING yang bisa melakukan aksi ini.", "warning"); return;
		}
		const sourceSessionId = BEJS.getSessionId();
		if (!sourceSessionId) { showAlert("Pilih artikel sumber dulu.", "warning"); return; }
		const targets = msel_copyTargetsBE.selectedOptionValues || [];
		if (targets.length === 0) { showAlert("Pilih minimal 1 artikel target.", "warning"); return; }

		const done = [], skipped = [], errors = [];
		for (const targetSessionId of targets) {
			if (String(targetSessionId) === String(sourceSessionId)) continue;
			try {
				const st = await getDivisionStatusForSession.run({ sessionId: targetSessionId });
				if ((st || []).some(s => s.division === 'BOTTOM_ENGINEERING' && s.state === 'SUBMITTED')) {
					skipped.push(targetSessionId); continue;
				}
				await copyBtmWIPInputDelete.run({ newSessionId: targetSessionId });
				await copyBtmWIPDelete.run({ newSessionId: targetSessionId });
				await copyBtmWIPInsert.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await carryOverBtmWIPInputIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await copySocklinerFlagsIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await submitDivision.run({ sessionId: targetSessionId, division: 'BOTTOM_ENGINEERING', state: 'IN_WORK', submittedBy: appsmith.user.email });
				done.push(targetSessionId);
			} catch (e) { errors.push(targetSessionId + ': ' + e.message); }
		}
		await getArticleList.run();
		resetWidget('msel_copyTargetsBE');
		showAlert(`Copy BE: ${done.length} artikel → IN_WORK. Dilewati (sudah submit): ${skipped.length}.`
							+ (errors.length ? ' GAGAL: ' + errors.join('; ') : ''), errors.length ? 'error' : 'success');
	},

}