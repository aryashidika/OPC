export default {

	_editWipId: null,
	_pendingAdd: [],
	_pendingRemove: [],

	// ─── HELPERS ──────────────────────────────────────────

	getSessionId() {
		return getDivisionStatus.data[0]?.session_id ?? null;
	},

	getUTStatus() {
		const ut = (getDivisionStatus.data || []).find(function(s) {
			return s.division === 'UPPER_TOOLING';
		});
		return ut ? ut.state : 'NOT_STARTED';
	},

	isLocked() {
		return UTJS.getUTStatus() === 'SUBMITTED';
	},

	// Reset semua state edit — dipanggil di banyak tempat
	async _resetEditState() {
		UTJS._editWipId = null;
		UTJS._pendingAdd = [];
		UTJS._pendingRemove = [];
		await storeValue('editWipId', 0);
		await storeValue('pendingAdd', []);
		await storeValue('pendingRemove', []);
		resetWidget('inp_processLabel');
		resetWidget('sel_supplier');
	},

	// ─── PAGE LOAD ────────────────────────────────────────

	async onPageLoad() {
		const u = appsmith.store.currentUser;
		const SESSION_HOURS = 12;
		const expired = !u || !u.loginAt || (Date.now() - u.loginAt) > SESSION_HOURS * 3600 * 1000;
		if (expired) {
			await storeValue('currentUser', null);
			navigateTo('Login');
			return;
		}

		await UTJS._resetEditState();
		await getSupplierMaster.run();
		await getArticleList.run();
		const articleFromUrl = appsmith.URL.queryParams.article_id;
		if (articleFromUrl) {
			await storeValue('activeArticleId', articleFromUrl);
			await resetWidget('sel_article');
			await UTJS.onArticleSelect();
		}
	},

	// ─── ARTICLE SELECT ───────────────────────────────────

	async onArticleSelect() {
		if (!sel_article.selectedOptionValue) return;
		await storeValue('activeArticleId', sel_article.selectedOptionValue);
		await UTJS._resetEditState();
		await Promise.all([
			getTreatmentCatalogId.run(),
			getDivisionStatus.run(),
			getWIPList.run(),
			getPartsCountForUT.run(),
			getAvailablePool.run()
		]);
	},

	// ─── WIP SELECT ───────────────────────────────────────

	async onSelectWIP() {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) return;
		if (UTJS.isLocked()) return;

		const selected = tbl_WIPList.selectedRow;
		if (!selected || !selected.id) {
			await UTJS._resetEditState();
			await getAvailablePool.run();
			return;
		}

		UTJS._editWipId = selected.id;
		UTJS._pendingAdd = [];
		UTJS._pendingRemove = [];
		await storeValue('editWipId', selected.id);
		await storeValue('pendingAdd', []);
		await storeValue('pendingRemove', []);
		resetWidget('inp_processLabel');
		resetWidget('sel_supplier');
		await getAvailablePool.run();
	},

	async onCancelEdit() {
		await UTJS._resetEditState();
		await getAvailablePool.run();
	},

	// ─── PENDING INPUT MANAGEMENT ─────────────────────────

	onMoveToInputs() {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) return;
		if (UTJS.isLocked()) return;
		const selectedRows = tbl_availablePool.selectedRows.filter(function(row) {
			return row && row.kind && row.ref != null;
		});
		if (selectedRows.length === 0) {
			showAlert('Pilih minimal 1 item dari pool.', 'warning');
			return;
		}
		selectedRows.forEach(function(row) {
			const removeIdx = UTJS._pendingRemove.findIndex(function(r) {
				return r.kind === row.kind && r.ref === row.ref;
			});
			if (removeIdx !== -1) {
				UTJS._pendingRemove.splice(removeIdx, 1);
			} else if (!UTJS._pendingAdd.some(function(a) { return a.kind === row.kind && a.ref === row.ref; })) {
				UTJS._pendingAdd.push({ kind: row.kind, ref: row.ref, label: row.label });
			}
		});
		showAlert(selectedRows.length + ' item ditandai untuk ditambah.', 'info');
	},

	onMoveToPool() {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) return;
		if (UTJS.isLocked()) return;
		const selectedRows = tbl_currentInputs.selectedRows.filter(function(row) {
			return row && row.kind && row.ref != null;
		});
		if (selectedRows.length === 0) {
			showAlert('Pilih minimal 1 item dari tabel kiri.', 'warning');
			return;
		}
		selectedRows.forEach(function(row) {
			const addIdx = UTJS._pendingAdd.findIndex(function(a) {
				return a.kind === row.kind && a.ref === row.ref;
			});
			if (addIdx !== -1) {
				UTJS._pendingAdd.splice(addIdx, 1);
			} else if (!UTJS._pendingRemove.some(function(r) { return r.kind === row.kind && r.ref === row.ref; })) {
				UTJS._pendingRemove.push({ kind: row.kind, ref: row.ref, label: row.label });
			}
		});
		showAlert(selectedRows.length + ' item ditandai untuk dihapus.', 'info');
	},

	// ─── CREATE / EDIT PROCESS ────────────────────────────

	validateForm() {
		if (!sel_article.selectedOptionValue) {
			showAlert('Pilih article terlebih dahulu.', 'warning');
			return false;
		}
		if (!inp_processLabel.text.trim()) {
			showAlert('Nama proses wajib diisi.', 'warning');
			return false;
		}
		return true;
	},

	async onCreateProcess() {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role UPPER_TOOLING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (UTJS.isLocked()) {
			showAlert('Sudah submitted, tidak bisa diedit.', 'warning');
			return;
		}
		if (!UTJS.validateForm()) return;

		const sessionId = UTJS.getSessionId();
		const label = inp_processLabel.text.trim();
		const supplierId = sel_supplier.selectedOptionValue || null;
		const supplierParam = supplierId ? String(supplierId) : '';
		const processId = getTreatmentCatalogId.data[0].id;
		const rawLT = inp_leadTimeDays.text;
		const leadTimeDays = (rawLT !== null && rawLT !== "" && rawLT !== undefined)
		? rawLT.toString()
		: '';

		try {
			if (UTJS._editWipId !== null) {
				// ── Edit mode ──
				await updateWIP.run({
					wipId: UTJS._editWipId,
					sessionId: sessionId,
					label: label,
					supplierId: supplierParam,
					leadTimeDays: leadTimeDays
				});

				await Promise.all(UTJS._pendingRemove.map(function(item) {
					return deleteWIPInputs.run({
						wipId: UTJS._editWipId,
						inputKind: item.kind,
						inputRef: item.ref
					});
				}));

				await Promise.all(UTJS._pendingAdd.map(function(item) {
					return addWIPInput.run({
						wipId: UTJS._editWipId,
						inputKind: item.kind,
						inputRef: item.ref
					});
				}));

				showAlert("Proses '" + label + "' berhasil diupdate.", 'success');

			} else {
				// ── Create mode ──
				await createWIP.run({
					sessionId: sessionId,
					processId: processId,
					label: label,
					supplierId: supplierParam,
					leadTimeDays: leadTimeDays,
					createdBy: appsmith.user.email
				});

				if (UTJS.getUTStatus() === 'NOT_STARTED') {
					await submitDivision.run({
						sessionId: sessionId,
						division: 'UPPER_TOOLING',
						state: 'IN_WORK',
						submittedBy: appsmith.user.email
					});
				}

				showAlert("Proses '" + label + "' berhasil dibuat.", 'success');
			}

			await UTJS._resetEditState();
			await getWIPList.run();
			await getAvailablePool.run();
			await getDivisionStatus.run();
			resetWidget('tbl_WIPList');

		} catch (e) {
			showAlert('Gagal: ' + e.message, 'error');
		}
	},

	// ─── DELETE WIP ───────────────────────────────────────

	async onDeleteWIP(wipId) {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role UPPER_TOOLING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (UTJS.isLocked()) {
			showAlert('Sudah submitted, tidak bisa diedit.', 'warning');
			return;
		}
		try {
			await deleteWIP.run({ wipId: wipId, sessionId: UTJS.getSessionId() });
			if (UTJS._editWipId === wipId) {
				await UTJS._resetEditState();
			}
			await getWIPList.run();
			await getAvailablePool.run();
			resetWidget('tbl_WIPList');
			showAlert('Proses dihapus.', 'success');
		} catch (e) {
			showAlert('Gagal hapus: ' + e.message, 'error');
		}
	},

	// ─── SUBMIT ───────────────────────────────────────────

	getWIPDisplay: function () {
		const wips = getWIPList.data || [];
		return wips.map(function (w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs || [];
			const stack = [w.id];
			const visited = [];
			let hasRawPart = false;
			while (stack.length > 0) {
				const currentId = stack.pop();
				if (visited.indexOf(currentId) !== -1) continue;
				visited.push(currentId);
				const currentWip = wips.find(function (x) {
					return x.id === currentId;
				});
				if (!currentWip) continue;
				const wipInputs = typeof currentWip.inputs === 'string' ? JSON.parse(currentWip.inputs) : currentWip.inputs || [];
				wipInputs.forEach(function (i) {
					if (i.kind === 'PART') hasRawPart = true; else if (i.kind === 'WIP') stack.push(i.ref);
				});
			}
			return {
				id: w.id,
				label: w.label,
				supplier_name: w.supplier_name || '-',
				lead_time_days: w.lead_time_days !== null && w.lead_time_days !== undefined ? w.lead_time_days : '-',
				inputs_label: inputs.map(function (i) { return i.label + ' (' + (i.kind === 'WIP' ? 'Package' : i.kind) + ')'; }).join(', ') || '-',
				is_empty: !hasRawPart,
				copied_from_article_id: w.copied_from_article_id || null
			};
		});
	},

	flattenWIPGroup(rootWipId, wips) {
		const partIds = [];
		const stack = [{ kind: 'WIP', ref: rootWipId }];
		const visited = [];
		while (stack.length > 0) {
			const current = stack.pop();
			if (current.kind === 'PART') { partIds.push(current.ref); continue; }
			if (visited.indexOf(current.ref) !== -1) continue;
			visited.push(current.ref);
			const wip = wips.find(function(w) { return w.id === current.ref; });
			if (!wip) continue;
			const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : (wip.inputs || []);
			inputs.forEach(function(i) { stack.push({ kind: i.kind, ref: i.ref }); });
		}
		return partIds;
	},

	getWIPGroups(wips) {
		const consumedWIPIds = [];
		wips.forEach(function(w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : (w.inputs || []);
			inputs.forEach(function(i) { if (i.kind === 'WIP') consumedWIPIds.push(i.ref); });
		});
		return wips
			.filter(function(w) { return consumedWIPIds.indexOf(w.id) === -1; })
			.map(function(w) {
			return {
				rootWipId: w.id,
				rootWipLabel: w.label,
				partIds: UTJS.flattenWIPGroup(w.id, wips)
			};
		});
	},

	validatePackagesVsWIPGroups(cosPackages, wipGroups) {
		const packageMap = {};
		cosPackages.forEach(function(row) {
			if (!row.package_id || !row.part_db_id) return;
			if (!packageMap[row.package_id]) packageMap[row.package_id] = { packageNo: row.package_no, partDbIds: [] };
			packageMap[row.package_id].partDbIds.push(row.part_db_id);
		});

		const errors = [];
		Object.keys(packageMap).forEach(function(packageId) {
			const pkg = packageMap[packageId];
			wipGroups.forEach(function(g) {
				const intersection = g.partIds.filter(function(pid) { return pkg.partDbIds.indexOf(pid) !== -1; });
				if (intersection.length === 0) return;
				const missing = g.partIds.filter(function(pid) { return pkg.partDbIds.indexOf(pid) === -1; });
				if (missing.length > 0) {
					errors.push({ packageNo: pkg.packageNo, packageId: packageId, rootWipLabel: g.rootWipLabel, missingPartDbIds: missing });
				}
			});
		});
		return errors;
	},

	async onCopyDivisionConfig() {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role UPPER_TOOLING yang bisa melakukan aksi ini.", "warning"); return;
		}
		const sourceSessionId = UTJS.getSessionId();
		if (!sourceSessionId) { showAlert("Pilih artikel sumber dulu.", "warning"); return; }
		const targets = msel_copyTargetsUT.selectedOptionValues || [];
		if (targets.length === 0) { showAlert("Pilih minimal 1 artikel target.", "warning"); return; }
		if ((getWIPList.data || []).length === 0) {
			showAlert("Artikel ini belum punya konfigurasi UT untuk dicopy.", "warning"); return;
		}

		const done = [], skipped = [], errors = [];
		for (const targetSessionId of targets) {
			if (String(targetSessionId) === String(sourceSessionId)) continue;
			try {
				const st = await getDivisionStatusForSession.run({ sessionId: targetSessionId });
				if ((st || []).some(s => s.division === 'UPPER_TOOLING' && s.state === 'SUBMITTED')) {
					skipped.push(targetSessionId); continue;
				}
				await copyWIPInputDelete.run({ newSessionId: targetSessionId });
				await copyWIPDelete.run({ newSessionId: targetSessionId });
				await copyWIPInsert.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await carryOverWIPInputIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await submitDivision.run({ sessionId: targetSessionId, division: 'UPPER_TOOLING', state: 'IN_WORK', submittedBy: appsmith.user.email });
				done.push(targetSessionId);
			} catch (e) { errors.push(targetSessionId + ': ' + e.message); }
		}
		await getArticleList.run();
		resetWidget('msel_copyTargetsUT');
		showAlert(`Copy UT: ${done.length} artikel → IN_WORK. Dilewati (sudah submit): ${skipped.length}.`
							+ (errors.length ? ' GAGAL: ' + errors.join('; ') : ''), errors.length ? 'error' : 'success');
	},

	async onSubmit() {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role UPPER_TOOLING  yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (UTJS.isLocked()) {
			showAlert('Sudah submitted.', 'warning');
			return;
		}

		const openConcerns = getOpenConcernsForUT.data || [];
		if (openConcerns.length > 0) {
			showAlert('Tutup semua concern dulu sebelum submit ulang.', 'warning');
			return;
		}

		const sessionId = UTJS.getSessionId();
		const wipDisplay = UTJS.getWIPDisplay();
		const emptyWIPs = wipDisplay.filter(function(w) { return w.is_empty; });
		if (emptyWIPs.length > 0) {
			showAlert('Package berikut tidak punya raw part: ' + emptyWIPs.map(function(w) { return w.label; }).join(', ') + '. Hapus atau assign input dulu.', 'warning');
			return;
		}

		// ─── VALIDASI WIP-VS-PACKAGE (UT → COS) ─────────────────
		const cosStatus = (getDivisionStatus.data || []).find(function(s) { return s.division === 'COS'; });
		if (cosStatus && cosStatus.state === 'SUBMITTED') {
			const wips = getWIPList.data || [];
			const wipGroups = UTJS.getWIPGroups(wips);
			if (wipGroups.length > 0) {
				const cosPackages = await getCOSPackagesForUT.run();
				const validationErrors = UTJS.validatePackagesVsWIPGroups(cosPackages, wipGroups);
				if (validationErrors.length > 0) {
					await Promise.all(validationErrors.map(function(err) {
						return createConcernUT.run({
							sessionId: sessionId,
							targetDivision: 'COS',
							raisedBy: appsmith.user.email,
							reason: 'Package ' + err.packageNo + ' tidak lengkap untuk Pcackage group "' + err.rootWipLabel + '". ' + err.missingPartDbIds.length + ' part kurang.',
							itemRef: String(err.packageNo),
							concernMetadata: JSON.stringify({ wip_group: err.rootWipLabel, package_no: err.packageNo, missing_part_db_ids: err.missingPartDbIds })
						});
					}));
					await setDivisionRework.run({ sessionId: sessionId, division: 'COS' });
					showAlert(validationErrors.length + ' concern dibuat ke COS.', 'warning');
				}
			}
		}

		// ─── VALIDASI CUTTING INLINE VS TREATMENT (UT → COMMERZ) ──
		const commerzStatus = (getDivisionStatus.data || []).find(function (s) { return s.division === 'COMMERZ'; });
		if (commerzStatus && commerzStatus.state === 'SUBMITTED') {
			const inlineParts = await getPartsInlineInTreatment.run();
			if (inlineParts && inlineParts.length > 0) {
				await Promise.all(inlineParts.map(function (p) {
					return createConcernUT.run({
						sessionId: sessionId,
						targetDivision: 'COMMERZ',
						raisedBy: appsmith.user.email,
						reason: 'Part ' + p.part_id + ' (' + p.part_name + ') cutting INLINE tapi masuk Package treatment UT.',
						itemRef: p.part_id,
						concernMetadata: JSON.stringify({ part_db_id: p.part_db_id, part_id: p.part_id, cutting_type: p.cutting_type })
					});
				}));
				await setDivisionRework.run({ sessionId: sessionId, division: 'COMMERZ' });
				showAlert(inlineParts.length + ' concern dibuat ke Commerz (cutting INLINE vs masuk treatment UT).', 'warning');
			}
		}

		try {
			await submitDivision.run({
				sessionId: sessionId,
				division: 'UPPER_TOOLING',
				state: 'SUBMITTED',
				submittedBy: appsmith.user.email
			});
			await getDivisionStatus.run();
			await getRevisionArticles.run();
			showAlert('Upper Tooling submitted!', 'success');
		} catch (e) {
			showAlert('Gagal submit: ' + e.message, 'error');
		}
	},

	isEditMode() {
		return !!appsmith.store.editWipId;
	},

	getFormLabel() {
		return appsmith.store.editWipId ? 'Simpan Perubahan' : 'Buat Proses';
	},

	onCloseAllConcernsUT: async function () {
		if (!['UPPER_TOOLING', 'ADMIN'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role UPPER_TOOLING yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const concerns = getOpenConcernsForUT.data || [];
		if (concerns.length === 0) {
			showAlert("Tidak ada concern terbuka.", "info");
			return;
		}
		try {
			await Promise.all(concerns.map(function (c) {
				return closeConcernUT.run({ concernId: c.id, closedBy: appsmith.user.email });
			}));
			await getOpenConcernsForUT.run();
			await getRevisionArticles.run();
			showAlert("Semua concern ditutup.", "success");
		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

}