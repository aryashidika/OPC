export default {

	_pendingChanges: {},

	getBlackboxStatus: function () {
		const statuses = pbb_getDivisionStatus.data;
		if (!statuses || statuses.length === 0) return 'NOT_STARTED';
		const bb = statuses.find(s => s.division === 'BLACKBOX');
		return bb ? bb.state : 'NOT_STARTED';
	},

	isLocked: function () {
		return BlackboxJS.getBlackboxStatus() === 'SUBMITTED';
	},

	onPageLoad: async function () {
		if (!AuthJS.checkAuthGuard(null, 'PBB')) return;

		BlackboxJS._pendingChanges = {};
		await pbb_getArticleList.run();
		const articleFromUrl = appsmith.URL.queryParams.article_id;
		if (articleFromUrl) {
			await storeValue('activeArticleId', articleFromUrl);
			await resetWidget('sel_article');
			storeValue('_trigger', Date.now());
			await new Promise(function (resolve) { setTimeout(resolve, 300); });
			await BlackboxJS.onArticleSelect();
		}
	},

	onAssign: function () {
		if (appsmith.store.currentUser?.role !== 'BLACKBOX') {
			showAlert("Hanya role BLACKBOX yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BlackboxJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const machine = sel_machine.selectedOptionValue;
		if (machine === undefined || machine === null || machine === "") {
			showAlert("Pilih mesin dulu sebelum assign.", "warning");
			return;
		}

		const selectedRows = tbl_blackboxParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 part dulu dari tabel.", "warning");
			return;
		}

		const rawLT = inp_leadTimeOverride.text;
		const leadTimeOverride = (rawLT !== null && rawLT !== "" && rawLT !== undefined)
		? parseInt(rawLT)
		: null;

		const machineLabel = sel_machine.selectedOptionLabel || "Tidak Ada";

		selectedRows.forEach(function (row) {
			BlackboxJS._pendingChanges[row.part_id] = {
				machine: machine,
				leadTimeOverride: leadTimeOverride
			};
		});

		showAlert(
			selectedRows.length + " part di-assign ke: " + machineLabel +
			(leadTimeOverride !== null ? " | LT: " + leadTimeOverride + " hari" : " | LT: default") +
			". Klik Save All untuk menyimpan.",
			"info"
		);
	},

	onClearAssign: function () {
		if (appsmith.store.currentUser?.role !== 'BLACKBOX') {
			showAlert("Hanya role BLACKBOX yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BlackboxJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const selectedRows = tbl_blackboxParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 part dulu dari tabel.", "warning");
			return;
		}

		const parts = pbb_getPartsForDivision.data || [];

		selectedRows.forEach(function (row) {
			const dbRow = parts.find(function (p) {
				return p.part_id === row.part_id;
			});
			const dbValue = dbRow ? dbRow.laminating_machine : null;

			if (dbValue === null || dbValue === "" || dbValue === undefined) {
				delete BlackboxJS._pendingChanges[row.part_id];
			} else {
				BlackboxJS._pendingChanges[row.part_id] = null;
			}
		});

		showAlert(
			selectedRows.length + " part assignment dihapus. Klik Save All untuk menyimpan.",
			"info"
		);
	},

	getTableData: function () {
		const parts = (pbb_getPartsForDivision.data || []).slice().sort(function(a, b) {
			const aParts = a.part_id.split('-');
			const bParts = b.part_id.split('-');
			const aMain = parseInt(aParts[0]) || 0;
			const bMain = parseInt(bParts[0]) || 0;
			if (aMain !== bMain) return aMain - bMain;
			const aSub = parseInt(aParts[1]) || 0;
			const bSub = parseInt(bParts[1]) || 0;
			return aSub - bSub;
		});

		const catalog = pbb_getCatalogBlackbox.data || [];

		return parts.map(function (p) {
			const hasPending = BlackboxJS._pendingChanges.hasOwnProperty(p.part_id);
			const pending = BlackboxJS._pendingChanges[p.part_id];

			let displayMachine, displayLeadTime, isOverride;

			if (!hasPending) {
				displayMachine = p.laminating_machine || "Tidak Ada";
				displayLeadTime = p.lead_time_lam_override_days !== null && p.lead_time_lam_override_days !== undefined
					? p.lead_time_lam_override_days
				: p.effective_lead_time_days;
				isOverride = p.lead_time_lam_override_days !== null && p.lead_time_lam_override_days !== undefined;
			} else if (pending === null || pending.machine === null || pending.machine === "") {
				displayMachine = "Tidak Ada";
				displayLeadTime = null;
				isOverride = false;
			} else {
				displayMachine = pending.machine;
				if (pending.leadTimeOverride !== null && pending.leadTimeOverride !== undefined) {
					displayLeadTime = pending.leadTimeOverride;
					isOverride = true;
				} else {
					const cat = catalog.find(c => c.process_name === pending.machine);
					displayLeadTime = cat ? cat.default_lead_time_days : null;
					isOverride = false;
				}
			}

			return {
				id: p.id,
				part_id: p.part_id,
				part_name: p.part_name,
				material_desc: p.material_desc,
				prod_uom: p.prod_uom,
				laminating_machine: displayMachine,
				lead_time_days: displayLeadTime,
				is_lead_time_override: isOverride,
				has_pending: hasPending,
				is_assigned: !hasPending && (p.laminating_machine !== null && p.laminating_machine !== "" && p.laminating_machine !== undefined)
			};
		});
	},

	onSaveDraft: async function () {
		if (appsmith.store.currentUser?.role !== 'BLACKBOX') {
			showAlert("Hanya role BLACKBOX yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BlackboxJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const changes = BlackboxJS._pendingChanges;
		const partIds = Object.keys(changes).filter(function (k) {
			return k !== "undefined" && k !== undefined;
		});

		if (partIds.length === 0) {
			showAlert("Tidak ada perubahan yang di-assign.", "info");
			return;
		}

		try {
			await Promise.all(partIds.map(function (partId) {
				const c = changes[partId];
				return pbb_upsertLaminating.run({
					sessionId: pbb_getDivisionStatus.data[0]?.session_id,
					partId: partId,
					laminatingMachine: (c && c.machine) ? c.machine : '',
					leadTimeOverride: (c && c.leadTimeOverride !== null && c.leadTimeOverride !== undefined) 
					? c.leadTimeOverride 
					: ''
				});
			}));
			if (BlackboxJS.getBlackboxStatus() === 'NOT_STARTED') {
				await pbb_submitDivision.run({
					sessionId: pbb_getDivisionStatus.data[0]?.session_id,
					division: 'BLACKBOX',
					state: 'IN_WORK',
					submittedBy: appsmith.user.email
				});
			}
			BlackboxJS._pendingChanges = {};
			await pbb_getPartsForDivision.run();
			await pbb_getDivisionStatus.run();
			showAlert("Berhasil disimpan!", "success");
		} catch (e) {
			showAlert("Gagal save: " + e.message, "error");
		}
	},

	onSubmit: async function () {
		if (appsmith.store.currentUser?.role !== 'BLACKBOX') {
			showAlert("Hanya role BLACKBOX yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (BlackboxJS.isLocked()) {
			showAlert("Sudah submitted.", "warning");
			return;
		}
		const openConcerns = pbb_getOpenConcernsForBlackbox.data || [];
		if (openConcerns.length > 0) {
			showAlert("Tutup semua concern dulu sebelum submit ulang.", "warning");
			return;
		}
		if (Object.keys(BlackboxJS._pendingChanges).length > 0) {
			await BlackboxJS.onSaveDraft();
		}
		try {
			await pbb_submitDivision.run({
				sessionId: pbb_getDivisionStatus.data[0]?.session_id,
				division: 'BLACKBOX',
				state: 'SUBMITTED',
				submittedBy: appsmith.user.email
			});
			await pbb_getDivisionStatus.run();
			await pbb_getRevisionArticles.run();
			showAlert("Blackbox submitted!", "success");
		} catch (e) {
			showAlert("Gagal submit: " + e.message, "error");
		}
	},

	async onCopyDivisionConfig() {
		if (appsmith.store.currentUser?.role !== 'BLACKBOX') { showAlert("Hanya role BLACKBOX yang bisa melakukan aksi ini.", "warning"); return; }
		const sourceSessionId = pbb_getDivisionStatus.data?.[0]?.session_id;
		if (!sourceSessionId) { showAlert("Pilih artikel sumber dulu.", "warning"); return; }
		const src = (pbb_getDivisionStatus.data || []).find(s => s.division === 'BLACKBOX');
		if (!src || src.state === 'NOT_STARTED') { showAlert("Artikel ini belum ada konfigurasi Blackbox untuk dicopy.", "warning"); return; }
		const targets = msel_copyTargetsBB.selectedOptionValues || [];
		if (targets.length === 0) { showAlert("Pilih minimal 1 artikel target.", "warning"); return; }

		const done = [], skipped = [], errors = [];
		for (const targetSessionId of targets) {
			if (String(targetSessionId) === String(sourceSessionId)) continue;
			try {
				const st = await pbb_getDivisionStatusForSessio.run({ sessionId: targetSessionId });
				if ((st || []).some(s => s.division === 'BLACKBOX' && s.state === 'SUBMITTED')) { skipped.push(targetSessionId); continue; }
				await pbb_copyBlackboxProcess.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await pbb_submitDivision.run({ sessionId: targetSessionId, division: 'BLACKBOX', state: 'IN_WORK', submittedBy: appsmith.user.email });
				done.push(targetSessionId);
			} catch (e) { errors.push(targetSessionId + ': ' + e.message); }
		}
		await pbb_getArticleList.run();
		resetWidget('msel_copyTargetsBB');
		showAlert(`Copy Blackbox: ${done.length} artikel → IN_WORK. Dilewati (sudah submit): ${skipped.length}.` + (errors.length ? ' GAGAL: ' + errors.join('; ') : ''), errors.length ? 'error' : 'success');
	},

	onArticleSelect: async function () {
		if (!sel_article.selectedOptionValue) return;
		BlackboxJS._pendingChanges = {};
		await pbb_getDivisionStatus.run();
		await pbb_getPartsForDivision.run();
		await pbb_getCatalogBlackbox.run();
	},

	async onCloseAllConcernsBlackbox() {
		if (appsmith.store.currentUser?.role !== 'BLACKBOX') {
			showAlert("Hanya role BLACKBOX yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const concerns = pbb_getOpenConcernsForBlackbox.data || [];
		if (concerns.length === 0) {
			showAlert("Tidak ada concern terbuka.", "info");
			return;
		}
		try {
			await Promise.all(concerns.map((c) =>
																		 pbb_closeConcernBlackbox.run({ concernId: c.id, closedBy: appsmith.user.email })
																		));
			await pbb_getOpenConcernsForBlackbox.run();
			showAlert("Semua concern ditutup.", "success");
		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

}