export default {

	_pendingChanges: {},

	onPageLoad: async function () {
		if (!AuthJS.checkAuthGuard(null, 'PRB')) return;

		CommerzJS._pendingChanges = {};
		await getArticleList.run();
		const articleFromUrl = appsmith.URL.queryParams.article_id;
		if (articleFromUrl) {
			await storeValue('activeArticleId', articleFromUrl);
			await resetWidget('sel_article');
			storeValue('_trigger', Date.now());
			await CommerzJS.onArticleSelect();
		}
	},

	filterSubParts: function (rows) {
		if (sw_showSubPartsCommerz.isSwitchedOn) return rows || [];
		return (rows || []).filter(function (r) {
			return String(r.part_id ?? r.code ?? '').indexOf('-') === -1;
		});
	},

	getCommerzStatus: function () {
		const statuses = getDivisionStatus.data;
		if (!statuses || statuses.length === 0) return 'NOT_STARTED';
		const cm = statuses.find(s => s.division === 'COMMERZ');
		return cm ? cm.state : 'NOT_STARTED';
	},

	isLocked: function () {
		return CommerzJS.getCommerzStatus() === 'SUBMITTED';
	},

	onArticleSelect: async function () {
		if (!sel_article.selectedOptionValue) return;
		CommerzJS._pendingChanges = {};
		await getCopyTargets.run();
		await getDivisionStatus.run();
		await getPartsForCommerz.run();
		await getCatalogCommerz.run();
		await getOpenConcernsForCommerz.run();
	},

	onAssign: function () {
		if (appsmith.store.currentUser?.role !== 'COMMERZ') {
			showAlert("Hanya role COMMERZ yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (CommerzJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const raw = sel_cuttingType.selectedOptionValue;
		if (!raw) {
			showAlert("Pilih tipe cutting dulu sebelum assign.", "warning");
			return;
		}

		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (e) {
			showAlert("Error parsing pilihan cutting.", "error");
			return;
		}

		const selectedRows = tbl_commerzParts.selectedRows.filter(function (row) {
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

		selectedRows.forEach(function (row) {
			CommerzJS._pendingChanges[row.part_id] = {
				cuttingType: parsed.cuttingType,
				processName: parsed.processName,
				leadTimeOverride: leadTimeOverride
			};
		});

		showAlert(
			selectedRows.length + " part di-assign ke: " + parsed.processName +
			(leadTimeOverride !== null ? " | LT: " + leadTimeOverride + " hari" : " | LT: default") +
			". Klik Save All untuk menyimpan.",
			"info"
		);
	},

	onClearAssign: function () {
		if (appsmith.store.currentUser?.role !== 'COMMERZ') {
			showAlert("Hanya role COMMERZ yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (CommerzJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const selectedRows = tbl_commerzParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 part dulu dari tabel.", "warning");
			return;
		}

		const parts = getPartsForCommerz.data || [];

		selectedRows.forEach(function (row) {
			const dbRow = parts.find(function (p) {
				return p.part_id === row.part_id;
			});
			const dbValue = dbRow ? dbRow.cutting_type : null;

			if (dbValue === null || dbValue === "" || dbValue === undefined) {
				delete CommerzJS._pendingChanges[row.part_id];
			} else {
				CommerzJS._pendingChanges[row.part_id] = null;
			}
		});

		showAlert(
			selectedRows.length + " part assignment dihapus. Klik Save All untuk menyimpan.",
			"info"
		);
	},

	getTableData: function () {
		const parts = CommerzJS.filterSubParts(getPartsForCommerz.data)
		.slice().sort(function(a, b) {
			const aParts = a.part_id.split('-');
			const bParts = b.part_id.split('-');
			const aMain = parseInt(aParts[0]) || 0;
			const bMain = parseInt(bParts[0]) || 0;
			if (aMain !== bMain) return aMain - bMain;
			const aSub = parseInt(aParts[1]) || 0;
			const bSub = parseInt(bParts[1]) || 0;
			return aSub - bSub;
		});

		const catalog = getCatalogCommerz.data || [];

		return parts.map(function (p) {
			const hasPending = CommerzJS._pendingChanges.hasOwnProperty(p.part_id);
			const pending = CommerzJS._pendingChanges[p.part_id];
			let displayType, displayLeadTime, isOverride;

			if (!hasPending) {
				displayType = p.cutting_process_name || p.cutting_type || "Tidak Ada";
				displayLeadTime = p.lead_time_cutting_override_days !== null && p.lead_time_cutting_override_days !== undefined
					? p.lead_time_cutting_override_days
				: p.effective_lead_time_days;
				isOverride = p.lead_time_cutting_override_days !== null && p.lead_time_cutting_override_days !== undefined;
			} else if (pending === null) {
				displayType = "Tidak Ada";
				displayLeadTime = null;
				isOverride = false;
			} else {
				displayType = pending.processName;
				if (pending.leadTimeOverride !== null && pending.leadTimeOverride !== undefined) {
					displayLeadTime = pending.leadTimeOverride;
					isOverride = true;
				} else {
					const cat = catalog.find(c => c.process_name === pending.processName);
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
				cutting_type: displayType,
				cutting_type_source: p.cutting_type_source || "-",
				lead_time_days: displayLeadTime,
				is_lead_time_override: isOverride,
				wip_behavior: p.wip_behavior || null,
				has_pending: hasPending,
				is_assigned: !hasPending && (p.cutting_type !== null && p.cutting_type !== "" && p.cutting_type !== undefined),
				cos_after: p.cos_after_package_no ? 'Package ' + p.cos_after_package_no + ' (' + (p.cos_after_type || '-') + ')' : '-',
				ut_treatment: p.ut_treatment_label || '-'
			};
		});
	},

	onSaveDraft: async function () {
		if (appsmith.store.currentUser?.role !== 'COMMERZ') {
			showAlert("Hanya role COMMERZ yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (CommerzJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const changes = CommerzJS._pendingChanges;
		const partIds = Object.keys(changes).filter(function (k) {
			return k !== "undefined" && k !== undefined;
		});

		if (partIds.length === 0) {
			showAlert("Tidak ada perubahan yang di-assign.", "info");
			return;
		}

		try {
			await Promise.all(partIds.map(function (partId) {
				const change = changes[partId];
				return upsertCutting.run({
					sessionId: getDivisionStatus.data[0]?.session_id,
					partId: partId,
					cuttingType: change ? change.cuttingType : '',
					cuttingTypeSource: 'TENTATIVE',
					cuttingProcessName: change ? change.processName : '',
					leadTimeOverride: (change && change.leadTimeOverride !== null && change.leadTimeOverride !== undefined)
					? change.leadTimeOverride
					: ''
				});
			}));
			if (CommerzJS.getCommerzStatus() === 'NOT_STARTED') {
				await submitDivision.run({
					sessionId: getDivisionStatus.data[0]?.session_id,
					division: 'COMMERZ',
					state: 'IN_WORK',
					submittedBy: appsmith.user.email
				});
			}
			CommerzJS._pendingChanges = {};
			await getPartsForCommerz.run();
			await getDivisionStatus.run();
			showAlert("Berhasil disimpan!", "success");
		} catch (e) {
			showAlert("Gagal save: " + e.message, "error");
		}
	},

	onSubmit: async function () {
		if (appsmith.store.currentUser?.role !== 'COMMERZ') {
			showAlert("Hanya role COMMERZ yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (CommerzJS.isLocked()) {
			showAlert("Sudah submitted.", "warning");
			return;
		}
		const openConcerns = getOpenConcernsForCommerz.data || [];
		if (openConcerns.length > 0) {
			showAlert("Tutup semua concern dulu sebelum submit ulang.", "warning");
			return;
		}

		if (Object.keys(CommerzJS._pendingChanges).length > 0) {
			await CommerzJS.onSaveDraft();
		}

		const parts = getPartsForCommerz.data || [];
		const stillConflict = parts.some(function (p) {
			return p.cutting_type === 'INLINE' && p.cos_type === 'CENTRAL';
		});
		if (stillConflict) {
			showAlert("Masih ada part dengan cutting INLINE dan COS CENTRAL. Selesaikan konflik dulu.", "warning");
			return;
		}

		const utStatus = (getDivisionStatus.data || []).find(function (s) {
			return s.division === 'UPPER_TOOLING';
		});
		if (utStatus && utStatus.state === 'SUBMITTED') {
			const stillInTreatment = parts.some(function (p) {
				return p.cutting_type === 'INLINE' && p.ut_treatment_label;
			});
			if (stillInTreatment) {
				showAlert("Masih ada part cutting INLINE yang terdaftar di Package treatment UT. Koordinasikan dengan UT dulu sebelum submit.", "warning");
				return;
			}
		}

		try {
			await submitDivision.run({
				sessionId: getDivisionStatus.data[0]?.session_id,
				division: 'COMMERZ',
				state: 'SUBMITTED',
				submittedBy: appsmith.user.email
			});
			await getDivisionStatus.run();
			await getRevisionArticles.run();
			showAlert("Commerz submitted!", "success");
		} catch (e) {
			showAlert("Gagal submit: " + e.message, "error");
		}
	},

	async onCopyDivisionConfig() {
		if (appsmith.store.currentUser?.role !== 'COMMERZ') { showAlert("Hanya role COMMERZ yang bisa melakukan aksi ini.", "warning"); return; }
		const sourceSessionId = getDivisionStatus.data?.[0]?.session_id;
		if (!sourceSessionId) { showAlert("Pilih artikel sumber dulu.", "warning"); return; }
		const src = (getDivisionStatus.data || []).find(s => s.division === 'COMMERZ');
		if (!src || src.state === 'NOT_STARTED') { showAlert("Artikel ini belum ada konfigurasi COMMERZ untuk dicopy.", "warning"); return; }
		const targets = msel_copyTargetsBB.selectedOptionValues || [];
		if (targets.length === 0) { showAlert("Pilih minimal 1 artikel target.", "warning"); return; }

		const done = [], skipped = [], errors = [];
		for (const targetSessionId of targets) {
			if (String(targetSessionId) === String(sourceSessionId)) continue;
			try {
				const st = await getDivisionStatusForSession.run({ sessionId: targetSessionId });
				if ((st || []).some(s => s.division === 'COMMERZ' && s.state === 'SUBMITTED')) { skipped.push(targetSessionId); continue; }
				await copyCommerzProcess.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await submitDivision.run({ sessionId: targetSessionId, division: 'COMMERZ', state: 'IN_WORK', submittedBy: appsmith.user.email });
				done.push(targetSessionId);
			} catch (e) { errors.push(targetSessionId + ': ' + e.message); }
		}
		await getArticleList.run();
		resetWidget('msel_copyTargetsBB');
		showAlert(`Copy COMMERZ: ${done.length} artikel → IN_WORK. Dilewati (sudah submit): ${skipped.length}.` + (errors.length ? ' GAGAL: ' + errors.join('; ') : ''), errors.length ? 'error' : 'success');
	},

	onCloseAllConcernsCommerz: async function () {
		if (appsmith.store.currentUser?.role !== 'COMMERZ') {
			showAlert("Hanya role COMMERZ yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const concerns = getOpenConcernsForCommerz.data || [];
		if (concerns.length === 0) {
			showAlert("Tidak ada concern terbuka.", "info");
			return;
		}
		try {
			await Promise.all(concerns.map(function (c) {
				return closeConcernCommerz.run({ concernId: c.id, closedBy: appsmith.user.email });
			}));
			await getOpenConcernsForCommerz.run();
			await getRevisionArticles.run();
			showAlert("Semua concern ditutup.", "success");
		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

}