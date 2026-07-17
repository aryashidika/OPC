export default {

	_pendingChanges: {},
	_pendingBeforeChanges: {},
	_validationErrors: [],

	onPageLoad: async function () {
		const u = appsmith.store.currentUser;
		const SESSION_HOURS = 12;
		const expired = !u || !u.loginAt || (Date.now() - u.loginAt) > SESSION_HOURS * 3600 * 1000;
		if (expired) {
			await storeValue('currentUser', null);
			navigateTo('Login');
			return;
		}

		COSJS._pendingChanges = {};
		COSJS._validationErrors = [];
		await getArticleList.run();
		const articleFromUrl = appsmith.URL.queryParams.article_id;
		if (articleFromUrl) {
			await storeValue('activeArticleId', articleFromUrl);
			await resetWidget('sel_article');
			storeValue('_trigger', Date.now());
			await COSJS.onArticleSelect();
		}
	},

	getSessionId: function () {
		return getDivisionStatus.data[0]?.session_id;
	},

	getConcernGroups: function () {
		const concerns = getOpenConcernsForCOS.data || [];
		const wipStatus = getWIPGroupStatus.data || [];
		const activeGroups = [];
		const seenGroups = [];

		concerns.forEach(function (c) {
			const meta = c.concern_metadata || {};
			const wipGroup = meta.wip_group;
			if (!wipGroup || seenGroups.indexOf(wipGroup) !== -1) return;
			seenGroups.push(wipGroup);

			const groupParts = wipStatus.filter(function (p) {
				return p.wip_group === wipGroup;
			});

			const packageNos = groupParts
			.map(function (p) { return p.package_no; })
			.filter(function (p) { return p !== null && p !== undefined; });

			const allSamePackage = packageNos.length === groupParts.length &&
						packageNos.every(function (p) { return p === packageNos[0]; });

			activeGroups.push({
				wip_group: wipGroup,
				concern_ids: concerns
				.filter(function (c2) {
					return (c2.concern_metadata || {}).wip_group === wipGroup;
				})
				.map(function (c2) { return c2.id; }),
				parts: groupParts.map(function (p) {
					return {
						part_name: p.part_name,
						part_id: p.part_id,
						package_no: p.package_no ? 'Package ' + p.package_no : 'Belum assigned',
						is_assigned: p.package_no !== null && p.package_no !== undefined
					};
				}),
				can_resolve: allSamePackage
			});
		});

		return activeGroups;
	},

	onOpenConcernDetail: async function (concernId, wipGroupLabel, packageNo) {
		const packages = getPackageList.data || [];
		const pkg = packages.find(function (p) {
			return p.package_no === parseInt(packageNo);
		});

		await getWIPGroupDetailForConcern.run({
			wipGroupLabel: wipGroupLabel,
			packageId: pkg ? pkg.id : 0
		});

		showModal('mdl_concernDetail');
	},

	getConcernTable: function () {
		const wipStatus = getWIPGroupStatus.data || [];
		const concerns = getOpenConcernsForCOS.data || [];
		if (concerns.length === 0) return [];

		const activeGroups = [];
		concerns.forEach(function (c) {
			const meta = c.concern_metadata || {};
			if (meta.wip_group && activeGroups.indexOf(meta.wip_group) === -1) {
				activeGroups.push(meta.wip_group);
			}
		});

		const rows = [];
		activeGroups.forEach(function (group) {
			const groupParts = wipStatus.filter(function (p) {
				return p.wip_group === group;
			});
			const packageNos = groupParts
			.map(function (p) { return p.package_no; })
			.filter(function (p) { return p !== null && p !== undefined; });
			const allSame = packageNos.length === groupParts.length &&
						packageNos.every(function (p) { return p === packageNos[0]; });

			groupParts.forEach(function (p) {
				rows.push({
					wip_group: group,
					part_name: p.part_name,
					part_id: p.part_id,
					package_no: p.package_no ? 'Package ' + p.package_no : 'Belum assigned',
					is_assigned: p.package_no !== null && p.package_no !== undefined,
					can_resolve: allSame
				});
			});
		});

		return rows;
	},

	canResolveAllConcerns: function () {
		const rows = COSJS.getConcernTable();
		if (rows.length === 0) return false;
		return rows.every(function (r) { return r.can_resolve; });
	},

	getConcernDetailDisplay: function () {
		const parts = getWIPGroupDetailForConcern.data || [];
		return parts.map(function (p) {
			return {
				part_name: p.part_name,
				part_id: p.part_id,
				package_no: p.package_no ? 'Package ' + p.package_no : 'Belum assigned',
				in_target_package: p.in_target_package,
				status: p.in_target_package ? '✓ Ada' : '✗ Kurang'
			};
		});
	},

	getCOSStatus: function () {
		const statuses = getDivisionStatus.data;
		if (!statuses || statuses.length === 0) return 'NOT_STARTED';
		const cos = statuses.find(function (s) {
			return s.division === 'COS';
		});
		return cos ? cos.state : 'NOT_STARTED';
	},

	isLocked: function () {
		return COSJS.getCOSStatus() === 'SUBMITTED' || COSJS.isPackagesReady();
	},

	canEditAsCOS: function () {
		const u = appsmith.store.currentUser;
		return !!(u && u.role === 'COS') && !COSJS.isLocked();
	},

	canEditAsME: function () {
		const u = appsmith.store.currentUser;
		return !!(u && u.role === 'ME') && COSJS.isPackagesReady() && COSJS.getCOSStatus() !== 'SUBMITTED';
	},

	isPackagesReady: function () {
		const statuses = getDivisionStatus.data || [];
		const cos = statuses.find(function (s) { return s.division === 'COS'; });
		return !!(cos && cos.packages_ready_at);
	},

	getExistingPackage: function () {
		const packageNo = inp_packageNo.text.trim();
		if (!packageNo || isNaN(packageNo)) return null;
		const existing = getPackageList.data || [];
		return existing.find(function (p) {
			return p.package_no === parseInt(packageNo);
		}) || null;
	},

	getPackageStatus: function () {
		const packageNo = inp_packageNo.text.trim();
		if (!packageNo || isNaN(packageNo)) return '';
		const pkg = COSJS.getExistingPackage();
		if (pkg) {
			return 'Package ' + pkg.package_no + ' — ' + pkg.cos_type + ' (' + pkg.jumlah_part + ' parts)';
		}
		return 'Package baru — belum ada';
	},

	getAutoFillCosType: function () {
		const pkg = COSJS.getExistingPackage();
		return pkg ? pkg.cos_type : '';
	},

	getValidationErrors: function () {
		return COSJS._validationErrors || [];
	},

	flattenWIPGroup: function (rootWipId, wips) {
		const partIds = [];
		const stack = [{ kind: 'WIP', ref: rootWipId }];
		const visited = [];

		while (stack.length > 0) {
			const current = stack.pop();

			if (current.kind === 'PART') {
				partIds.push(current.ref);
				continue;
			}

			if (visited.indexOf(current.ref) !== -1) continue;
			visited.push(current.ref);

			const wip = wips.find(function (w) { return w.id === current.ref; });
			if (!wip) continue;

			const inputs = typeof wip.inputs === 'string' ? JSON.parse(wip.inputs) : wip.inputs;
			inputs.forEach(function (i) {
				stack.push({ kind: i.kind, ref: i.ref });
			});
		}

		return partIds;
	},

	getWIPGroups: function (wips) {
		const consumedWIPIds = [];
		wips.forEach(function (w) {
			const inputs = typeof w.inputs === 'string' ? JSON.parse(w.inputs) : w.inputs;
			inputs.forEach(function (i) {
				if (i.kind === 'WIP') consumedWIPIds.push(i.ref);
			});
		});

		const rootWIPs = wips.filter(function (w) {
			return consumedWIPIds.indexOf(w.id) === -1;
		});

		return rootWIPs.map(function (w) {
			return {
				rootWipId: w.id,
				rootWipLabel: w.label,
				partIds: COSJS.flattenWIPGroup(w.id, wips)
			};
		});
	},

	validatePackagesVsWIPGroups: function (partsForCOS, wipGroups) {
		const errors = [];

		const packageMap = {};
		partsForCOS.forEach(function (p) {
			if (!p.cos_package_id) return;
			if (!packageMap[p.cos_package_id]) {
				packageMap[p.cos_package_id] = {
					packageNo: p.package_no,
					partDbIds: []
				};
			}
			if (p.id) packageMap[p.cos_package_id].partDbIds.push(p.id);
		});

		Object.keys(packageMap).forEach(function (packageId) {
			const pkg = packageMap[packageId];
			const pkgPartIds = pkg.partDbIds;

			wipGroups.forEach(function (g) {
				const intersection = g.partIds.filter(function (pid) {
					return pkgPartIds.indexOf(pid) !== -1;
				});

				if (intersection.length === 0) return;

				const missing = g.partIds.filter(function (pid) {
					return pkgPartIds.indexOf(pid) === -1;
				});

				if (missing.length > 0) {
					errors.push({
						packageNo: pkg.packageNo,
						packageId: packageId,
						rootWipLabel: g.rootWipLabel,
						missingPartDbIds: missing
					});
				}
			});
		});

		return errors;
	},

	onCloseConcernCOS: async function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		const concerns = getOpenConcernsForCOS.data || [];
		try {
			await Promise.all(concerns.map(function (c) {
				return closeConcernCOS.run({ concernId: c.id, closedBy: appsmith.user.email });
			}));
			await getOpenConcernsForCOS.run();
			await getRevisionArticles.run();   // ⬅️ tambahan
			await getWIPGroupStatus.run();
			showAlert('Semua concern selesai.', 'success');
		} catch (e) {
			showAlert('Gagal: ' + e.message, 'error');
		}
	},

	onDeletePackage: async function (selected) {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		if (!selected || !selected.id) {
			showAlert("Pilih package dulu dari daftar.", "warning");
			return;
		}
		const changes = COSJS._pendingChanges;
		Object.keys(changes).forEach(function (partId) {
			if (changes[partId] && changes[partId].packageId === selected.id) {
				delete COSJS._pendingChanges[partId];
			}
		});
		try {
			await deletePackage.run({
				packageId: selected.id,
				sessionId: COSJS.getSessionId()
			});
			await getPartsForCOS.run();
			await getPackageList.run();
			await getWIPGroupStatus.run();
			await getOpenConcernsForCOS.run();
			showAlert("Package " + selected.package_no + " dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	// ─── AFTER TREATMENT ──────────────────────────────────────────────────────

	onAssign: async function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const packageNo = inp_packageNo.text.trim();
		if (!packageNo || isNaN(packageNo)) {
			showAlert("Isi nomor package dulu.", "warning");
			return;
		}

		const sessionId = COSJS.getSessionId();
		let pkg = COSJS.getExistingPackage();

		if (!pkg) {
			try {
				await createPackage.run({
					sessionId: sessionId,
					packageNo: parseInt(packageNo),
					cosType: '',
					leadTimeDays: '',
					createdBy: appsmith.user.email
				});
				await getPackageList.run();
				pkg = getPackageList.data.find(function (p) {
					return p.package_no === parseInt(packageNo);
				});
				if (!pkg) {
					showAlert("Gagal menemukan package setelah dibuat.", "error");
					return;
				}
				showAlert("Package " + packageNo + " dibuat.", "info");
			} catch (e) {
				showAlert("Gagal buat package: " + e.message, "error");
				return;
			}
		}

		const selectedRows = tbl_cosParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Package tersimpan. Pilih part untuk assign ke package ini.", "info");
			return;
		}

		selectedRows.forEach(function (row) {
			COSJS._pendingChanges[row.part_id] = {
				packageId: pkg.id,
				packageNo: pkg.package_no
			};
		});

		showAlert(
			selectedRows.length + " part di-assign ke Package " + pkg.package_no + ". Klik Save All untuk menyimpan.",
			"info"
		);
	},

	onUnassign: function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const selectedRows = tbl_cosParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 part dari tabel.", "warning");
			return;
		}

		const parts = getPartsForCOS.data || [];

		selectedRows.forEach(function (row) {
			const dbRow = parts.find(function (p) {
				return p.part_id === row.part_id;
			});
			const dbValue = dbRow ? dbRow.cos_package_id : null;

			if (dbValue === null || dbValue === undefined) {
				delete COSJS._pendingChanges[row.part_id];
			} else {
				COSJS._pendingChanges[row.part_id] = null;
			}
		});

		showAlert(
			selectedRows.length + " part di-unassign. Klik Save All untuk menyimpan.",
			"info"
		);
	},

	getTableData: function () {
		const parts = (getPartsForCOS.data || [])
		.filter(function(p) {
			return p.part_id.indexOf('-') === -1;
		})
		.slice().sort(function(a, b) {
			return parseInt(a.part_id) - parseInt(b.part_id);
		});

		const pkg = COSJS.getExistingPackage();
		const activePackageId = pkg ? pkg.id : null;
		const packages = getPackageList.data || [];

		return parts.map(function (p) {
			const hasPending = COSJS._pendingChanges.hasOwnProperty(p.part_id);
			const pending = COSJS._pendingChanges[p.part_id];
			let displayPackage, displayCosType, displayLeadTime;

			if (!hasPending) {
				displayPackage = p.package_no ? 'Package ' + p.package_no : 'Tidak Ada';
				displayCosType = p.cos_type || '-';
				const pkgData = packages.find(function(pk) { return pk.id === p.cos_package_id; });
				displayLeadTime = pkgData ? pkgData.lead_time_days : null;
			} else if (pending === null) {
				displayPackage = 'Tidak Ada';
				displayCosType = '-';
				displayLeadTime = null;
			} else {
				displayPackage = 'Package ' + pending.packageNo;
				displayCosType = pending.cosType;
				displayLeadTime = pending.leadTimeDays;
			}

			const isActivePackage = !hasPending && activePackageId !== null &&
						p.cos_package_id === activePackageId;

			return {
				id: p.id,
				part_id: p.part_id,
				part_name: p.part_name,
				material_desc: p.material_desc,
				prod_uom: p.prod_uom,
				package: displayPackage,
				cos_type: displayCosType,
				lead_time_days: displayLeadTime,
				cutting_type: p.cutting_process_name || p.cutting_type || '-',
				wip_group: p.wip_group || '-',
				remark: p.remark || '',
				has_pending: hasPending,
				is_assigned: !hasPending && p.cos_package_id !== null && p.cos_package_id !== undefined,
				is_active_package: isActivePackage
			};
		});
	},

	onSaveAll: async function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const changes = COSJS._pendingChanges;
		const partIds = Object.keys(changes).filter(function (k) {
			return k !== "undefined" && k !== undefined;
		});

		if (partIds.length === 0) {
			showAlert("Tidak ada perubahan.", "info");
			return;
		}

		const sessionId = COSJS.getSessionId();

		try {
			await Promise.all(partIds.map(function (partId) {
				const change = changes[partId];
				return assignPartsToPackage.run({
					sessionId: sessionId,
					partId: partId,
					cosType: change ? change.cosType : '',
					packageId: change ? change.packageId : 0
				});
			}));

			if (COSJS.getCOSStatus() === 'NOT_STARTED') {
				await submitDivision.run({
					sessionId: sessionId,
					division: 'COS',
					state: 'IN_WORK',
					submittedBy: appsmith.user.email
				});
			}

			COSJS._pendingChanges = {};
			await getPartsForCOS.run();
			await getPackageList.run();
			await getDivisionStatus.run();
			await getWIPGroupStatus.run();
			await getOpenConcernsForCOS.run();
			showAlert("Berhasil disimpan!", "success");
		} catch (e) {
			showAlert("Gagal save: " + e.message, "error");
		}
	},

	autoAdjustCutting: async function () {
		let concerns = 0;
		const sessionId = COSJS.getSessionId();

		// GATE — samakan dengan pola UTJS: hanya validasi kalau data Commerz sudah final
		const commerzStatus = (getDivisionStatus.data || []).find(function (s) {
			return s.division === 'COMMERZ';
		});
		if (!commerzStatus || commerzStatus.state !== 'SUBMITTED') {
			return { concerns };
		}

		const parts = await getPartsForAutoAdjust.run();
		if (!parts || parts.length === 0) return { concerns };

		await Promise.all(parts.map(async function (p) {
			await createConcern.run({
				sessionId: sessionId,
				targetDivision: 'COMMERZ',
				raisedBy: appsmith.user.email,
				reason: 'Part ' + p.part_id + ' memiliki cutting INLINE tapi COS CENTRAL — tidak konsisten. Mohon rekonsiliasi.',
				itemRef: p.part_id,
				concernSource: 'SYSTEM',
				concernMetadata: JSON.stringify({
					part_db_id: p.part_db_id,
					part_id: p.part_id,
					part_name: p.part_name,
					cutting_type: p.cutting_type,
					should_be: 'NORMAL',
					cos_type: p.cos_type,
					cos_package_no: p.package_no
				})
			});
			concerns++;
		}));

		if (concerns > 0) {
			await setDivisionRework.run({ sessionId: sessionId, division: 'COMMERZ' });
		}
		return { concerns };
	},

	onSubmitPackage: async function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Package sudah di-submit ke ME.", "warning");
			return;
		}
		if (Object.keys(COSJS._pendingChanges).length > 0) {
			await COSJS.onSaveAll();
		}
		if (Object.keys(COSJS._pendingBeforeChanges).length > 0) {
			await COSJS.onBeforeSaveDraft();
		}

		const emptyWarning = COSJS.getEmptyPackageWarning();
		if (emptyWarning) {
			showAlert(emptyWarning, "warning");
			return;
		}

		try {
			await markPackagesReady.run({ sessionId: COSJS.getSessionId() });
			await getDivisionStatus.run();
			showAlert("Package di-submit ke ME untuk alokasi.", "success");
		} catch (e) {
			showAlert("Gagal submit package: " + e.message, "error");
		}
	},
	onOpenAllocationModal: function (currentRow, isBefore) {
		if (appsmith.store.currentUser?.role !== 'ME') {
			showAlert("Hanya role ME yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!COSJS.isPackagesReady()) {
			showAlert("COS belum submit package — alokasi belum bisa dilakukan.", "warning");
			return;
		}
		if (COSJS.getCOSStatus() === 'SUBMITTED') {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		storeValue('selectedPackageForEdit', { ...currentRow, isBefore: !!isBefore });
		resetWidget('sel_meCosType');
		resetWidget('inp_meLeadTime');
		showModal('mdl_meAllocation');
	},

	onSaveAllocation: async function () {
		if (appsmith.store.currentUser?.role !== 'ME') {
			showAlert("Hanya role ME yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!COSJS.isPackagesReady()) {
			showAlert("COS belum submit package — alokasi belum bisa dilakukan.", "warning");
			return;
		}
		if (COSJS.getCOSStatus() === 'SUBMITTED') {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		const pkg = appsmith.store.selectedPackageForEdit;
		if (!pkg) return;

		const cosType = sel_meCosType.selectedOptionValue;
		const leadTimeDays = inp_meLeadTime.text;
		if (!cosType || leadTimeDays === '' || leadTimeDays === null || leadTimeDays === undefined) {
			showAlert("Alokasi dan lead time wajib diisi.", "warning");
			return;
		}

		try {
			if (pkg.isBefore) {
				await updateBeforePackageCosType.run({ packageId: pkg.id, sessionId: COSJS.getSessionId(), cosType });
				await updateBeforePackageLeadTime.run({ packageId: pkg.id, sessionId: COSJS.getSessionId(), leadTimeDays });
				await getBeforePackageList.run();
				await getPartsForBefore.run();
			} else {
				await updatePackageCosType.run({ packageId: pkg.id, sessionId: COSJS.getSessionId(), cosType });
				await updatePartsCosType.run({ sessionId: COSJS.getSessionId(), packageId: pkg.id, cosType });
				await updatePackageLeadTime.run({ packageId: pkg.id, sessionId: COSJS.getSessionId(), leadTimeDays });
				await getPackageList.run();
				await getPartsForCOS.run();
			}
			closeModal('mdl_meAllocation');
			storeValue('selectedPackageForEdit', null);
			showAlert("Alokasi Package " + pkg.package_no + " tersimpan.", "success");
		} catch (e) {
			showAlert("Gagal simpan alokasi: " + e.message, "error");
		}
	},

	onSubmit: async function () {
		if (appsmith.store.currentUser?.role !== 'ME') {
			showAlert("Hanya role ME yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!COSJS.isPackagesReady()) {
			showAlert("COS belum submit package — alokasi belum bisa dilakukan.", "warning");
			return;
		}
		if (COSJS.getCOSStatus() === 'SUBMITTED') {
			showAlert("Sudah submitted.", "warning");
			return;
		}

		if (!COSJS.isPackagesReady()) {
			showAlert("Submit Package dulu sebelum submit final.", "warning");
			return;
		}

		await getUnallocatedPackageCount.run({ sessionId: COSJS.getSessionId() });
		const ualRow = getUnallocatedPackageCount.data?.[0] || {};
		const pkgAfter = ualRow.unallocated_package_count || 0;
		const pkgBefore = ualRow.unallocated_before_package_count || 0;
		const partCorrupt = ualRow.unallocated_part_count || 0;

		if (pkgAfter > 0 || pkgBefore > 0 || partCorrupt > 0) {
			const msgs = [];
			if (pkgAfter > 0) msgs.push(pkgAfter + " package (After) belum lengkap alokasi/lead time");
			if (pkgBefore > 0) msgs.push(pkgBefore + " package (Before) belum lengkap alokasi/lead time");
			if (partCorrupt > 0) msgs.push(partCorrupt + " part cos_type kosong walau package-nya sudah dialokasi (data tidak konsisten, cek manual)");
			showAlert(msgs.join(", ") + ".", "warning");
			return;
		}

		const openConcerns = getOpenConcernsForCOS.data || [];
		if (openConcerns.length > 0) {
			showAlert("Tutup semua concern dulu sebelum submit ulang.", "warning");
			return;
		}

		const sessionId = COSJS.getSessionId();

		// ─── VALIDASI PACKAGE KOSONG (After + Before, di-share dgn onSubmitPackage) ───
		const emptyWarning = COSJS.getEmptyPackageWarning();
		if (emptyWarning) {
			showAlert(emptyWarning, "warning");
			return;
		}

		// ─── VALIDASI WIP GROUP VS PACKAGE ───────────────────
		const wips = getWIPDataForCOS.data || [];
		if (wips.length > 0) {
			const wipGroups = COSJS.getWIPGroups(wips);
			if (wipGroups.length > 0) {
				const partsForCOS = getPartsForCOS.data || [];
				const validationErrors = COSJS.validatePackagesVsWIPGroups(partsForCOS, wipGroups);
				if (validationErrors.length > 0) {
					await Promise.all(validationErrors.map(function (err) {
						return createConcern.run({
							sessionId:       sessionId,
							targetDivision:  'COS',
							raisedBy:        'SYSTEM',
							reason:          'Package ' + err.packageNo +
							' tidak lengkap untuk Package group "' + err.rootWipLabel + '".',
							itemRef:         String(err.packageNo),
							concernSource:   'SYSTEM',
							concernMetadata: JSON.stringify({
								wip_group:           err.rootWipLabel,
								package_no:          err.packageNo,
								missing_part_db_ids: err.missingPartDbIds
							})
						});
					}));
					await getOpenConcernsForCOS.run();
					showAlert(
						"Submit diblokir — " + validationErrors.length +
						" package tidak konsisten dengan Package group. Lihat concern untuk detail.",
						"error"
					);
					return;
				}
			}
		}

		// ─── SUBMIT ───────────────────────────────────────────
		COSJS._validationErrors = [];
		const adjustResult = await COSJS.autoAdjustCutting();

		try {
			await submitDivision.run({
				sessionId:   sessionId,
				division:    'COS',
				state:       'SUBMITTED',
				submittedBy: appsmith.user.email
			});
			await getDivisionStatus.run();
			await getRevisionArticles.run();

			if (adjustResult.concerns > 0) {
				showAlert(
					"COS submitted! " + adjustResult.concerns +
					" concern dibuat untuk Commerz (cutting INLINE vs COS CENTRAL).",
					"success"
				);
			} else {
				showAlert("COS submitted!", "success");
			}
		} catch (e) {
			showAlert("Gagal submit: " + e.message, "error");
		}
	},

	onArticleSelect: async function () {
		if (!sel_article.selectedOptionValue) return;
		COSJS._pendingChanges = {};
		COSJS._pendingBeforeChanges = {};
		COSJS._validationErrors = [];
		await getDivisionStatus.run();
		await getPartsForCOS.run();
		await getPartsForBefore.run();
		await getPackageList.run();
		await getBeforePackageList.run();
		await getOpenConcernsForCOS.run();
		await getWIPDataForCOS.run();
		await getWIPGroupsForCOS.run();
		await getWIPGroupStatus.run();
	},

	// ─── BEFORE TREATMENT ─────────────────────────────────────────────────────

	getBeforeExistingPackage: function () {
		const packageNo = inp_beforePackageNo.text.trim();
		if (!packageNo || isNaN(packageNo)) return null;
		const existing = getBeforePackageList.data || [];
		return existing.find(function (p) {
			return p.package_no === parseInt(packageNo);
		}) || null;
	},

	getBeforePackageStatus: function () {
		const packageNo = inp_beforePackageNo.text.trim();
		if (!packageNo || isNaN(packageNo)) return '';
		const pkg = COSJS.getBeforeExistingPackage();
		if (pkg) {
			return 'Package ' + pkg.package_no + ' — ' + pkg.cos_type + ' (' + pkg.jumlah_part + ' parts)';
		}
		return 'Package baru — belum ada';
	},

	getBeforeAutoFillCosType: function () {
		const pkg = COSJS.getBeforeExistingPackage();
		return pkg ? pkg.cos_type : '';
	},

	getBeforeTableData: function () {
		const parts = (getPartsForBefore.data || [])
		.slice()
		.sort(function (a, b) {
			return parseInt(a.part_id) - parseInt(b.part_id);
		});

		const pkg = COSJS.getBeforeExistingPackage();
		const activePackageId = pkg ? pkg.id : null;
		const packages = getBeforePackageList.data || [];

		return parts.map(function (p) {
			const hasPending = COSJS._pendingBeforeChanges.hasOwnProperty(p.part_id);
			const pending = COSJS._pendingBeforeChanges[p.part_id];
			let displayPackage, displayCosType, displayLeadTime;

			if (!hasPending) {
				displayPackage = p.before_package_no ? 'Package ' + p.before_package_no : 'Tidak Ada';
				displayCosType = p.before_cos_type || '-';
				const pkgData = packages.find(function(pk) { return pk.id === p.cos_before_package_id; });
				displayLeadTime = pkgData ? pkgData.lead_time_days : null;
			} else if (pending === null) {
				displayPackage = 'Tidak Ada';
				displayCosType = '-';
				displayLeadTime = null;
			} else {
				displayPackage = 'Package ' + pending.packageNo;
				displayCosType = pending.cosType;
				displayLeadTime = pending.leadTimeDays;
			}

			const isActivePackage = !hasPending && activePackageId !== null &&
						p.cos_before_package_id === activePackageId;

			return {
				id:                p.id,
				part_id:           p.part_id,
				part_name:         p.part_name,
				material_desc:     p.material_desc,
				before_package:    displayPackage,
				before_cos_type:   displayCosType,
				lead_time_days:    displayLeadTime,
				remark: 					 p.remark || '',
				has_pending:       hasPending,
				is_assigned:       !hasPending && p.cos_before_package_id !== null && p.cos_before_package_id !== undefined,
				is_active_package: isActivePackage
			};
		});
	},

	onBeforeAssign: async function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const packageNo = inp_beforePackageNo.text.trim();
		if (!packageNo || isNaN(packageNo)) {
			showAlert("Isi nomor package dulu.", "warning");
			return;
		}

		const sessionId = COSJS.getSessionId();
		let pkg = COSJS.getBeforeExistingPackage();

		if (!pkg) {
			// Package belum ada — buat baru, cos_type/lead time kosong (domain ME)
			try {
				await createBeforePackage.run({
					sessionId:    sessionId,
					packageNo:    parseInt(packageNo),
					cosType:      '',
					leadTimeDays: '',
					createdBy:    appsmith.user.email
				});
				await getBeforePackageList.run();
				pkg = getBeforePackageList.data.find(function (p) {
					return p.package_no === parseInt(packageNo);
				});
				if (!pkg) {
					showAlert("Gagal menemukan package setelah dibuat.", "error");
					return;
				}
				showAlert("Package " + packageNo + " dibuat.", "info");
			} catch (e) {
				showAlert("Gagal buat package: " + e.message, "error");
				return;
			}
		}

		// Part bersifat opsional — bisa assign belakangan
		const selectedRows = tbl_beforeParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Package tersimpan. Pilih part untuk assign ke package ini.", "info");
			return;
		}

		selectedRows.forEach(function (row) {
			COSJS._pendingBeforeChanges[row.part_id] = {
				packageId: pkg.id,
				packageNo: pkg.package_no
			};
		});

		showAlert(
			selectedRows.length + " part di-assign ke Package " + pkg.package_no + ". Klik Save Draft untuk menyimpan.",
			"info"
		);
	},

	onBeforeUnassign: function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const selectedRows = tbl_beforeParts.selectedRows.filter(function (row) {
			return row && row.part_id !== undefined && row.part_id !== null;
		});

		if (selectedRows.length === 0) {
			showAlert("Pilih minimal 1 part dari tabel.", "warning");
			return;
		}

		const parts = getPartsForBefore.data || [];

		selectedRows.forEach(function (row) {
			const dbRow = parts.find(function (p) {
				return p.part_id === row.part_id;
			});
			const dbValue = dbRow ? dbRow.cos_before_package_id : null;

			if (dbValue === null || dbValue === undefined) {
				delete COSJS._pendingBeforeChanges[row.part_id];
			} else {
				COSJS._pendingBeforeChanges[row.part_id] = null;
			}
		});

		showAlert(
			selectedRows.length + " part di-unassign. Klik Save Draft untuk menyimpan.",
			"info"
		);
	},

	onBeforeSaveDraft: async function () {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const changes = COSJS._pendingBeforeChanges;
		const partIds = Object.keys(changes).filter(function (k) {
			return k !== "undefined" && k !== undefined;
		});

		if (partIds.length === 0) {
			showAlert("Tidak ada perubahan.", "info");
			return;
		}

		const sessionId = COSJS.getSessionId();

		try {
			await Promise.all(partIds.map(function (partId) {
				const change = changes[partId];
				if (change === null) {
					return unassignPartFromBeforePackage.run({
						sessionId: sessionId,
						partId:    partId
					});
				}
				return assignPartToBeforePackage.run({
					sessionId: sessionId,
					partId:    partId,
					packageId: change.packageId
				});
			}));

			COSJS._pendingBeforeChanges = {};
			await getPartsForBefore.run();
			await getBeforePackageList.run();
			showAlert("Before treatment berhasil disimpan!", "success");
		} catch (e) {
			showAlert("Gagal save: " + e.message, "error");
		}
	},

	onBeforeDeletePackage: async function (selected) {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		if (!selected || !selected.id) {
			showAlert("Pilih package dulu.", "warning");
			return;
		}

		const changes = COSJS._pendingBeforeChanges;
		Object.keys(changes).forEach(function (partId) {
			if (changes[partId] && changes[partId].packageId === selected.id) {
				delete COSJS._pendingBeforeChanges[partId];
			}
		});

		try {
			await deleteBeforePackage.run({
				packageId: selected.id,
				sessionId: COSJS.getSessionId()
			});
			await getBeforePackageList.run();
			await getPartsForBefore.run();
			showAlert("Package " + selected.package_no + " dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	onSaveRemark: async function (source) {
		if (appsmith.store.currentUser?.role !== 'COS') {
			showAlert("Hanya role COS yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (COSJS.isLocked()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}
		const row = source === 'before' ? tbl_beforeParts.updatedRow : tbl_cosParts.updatedRow;
		if (!row || !row.part_id) return;

		const query = source === 'before' ? upsertPartRemarkBefore : upsertPartRemarkAfter;
		const safeRemark = (row.remark || '').replace(/'/g, "''");   // BARU — escape apostrof
		try {
			await query.run({
				sessionId: COSJS.getSessionId(),
				partId: row.part_id,
				remark: safeRemark
			});
			await getPartsForCOS.run();
			await getPartsForBefore.run();
		} catch (e) {
			showAlert("Gagal simpan remark: " + e.message, "error");
		}
	},

	getEmptyPackageWarning: function () {
		const packages = getPackageList.data || [];
		const emptyAfterPackages = packages.filter(function (p) {
			return p.jumlah_part === 0 || p.jumlah_part === '0';
		});

		const beforePackages = getBeforePackageList.data || [];
		const emptyBeforePackages = beforePackages.filter(function (p) {
			return p.jumlah_part === 0 || p.jumlah_part === '0';
		});

		if (emptyAfterPackages.length === 0 && emptyBeforePackages.length === 0) {
			return null;
		}

		const msgs = [];
		if (emptyAfterPackages.length > 0) {
			msgs.push(emptyAfterPackages.length + " after package tidak punya part");
		}
		if (emptyBeforePackages.length > 0) {
			msgs.push(emptyBeforePackages.length + " before package tidak punya part");
		}
		return msgs.join(", ") + ". Assign part atau hapus package kosong.";
	},

	onReworkToCOS: async function () {
		if (appsmith.store.currentUser?.role !== 'ME') {
			showAlert("Hanya role ME yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!COSJS.canEditAsME()) {
			showAlert("Rework hanya bisa dilakukan setelah package di-submit dan sebelum submit final.", "warning");
			return;
		}

		const sessionId = COSJS.getSessionId();
		try {
			await setDivisionRework.run({ sessionId: sessionId, division: 'COS' });
			await getDivisionStatus.run();
			await getPackageList.run();
			await getBeforePackageList.run();
			await getPartsForCOS.run();
			await getPartsForBefore.run();
			showAlert("Dikembalikan ke COS untuk rework.", "success");
		} catch (e) {
			showAlert("Gagal kirim rework: " + e.message, "error");
		}
	},

	onSaveMERemark: async function () {
		if (appsmith.store.currentUser?.role !== 'ME') {
			showAlert("Hanya role ME yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!COSJS.canEditAsME()) {
			showAlert("Sudah submitted, tidak bisa diedit.", "warning");
			return;
		}

		const row = tbl_meAllocationParts.updatedRow;
		if (!row || !row.part_id) return;

		const pkg = appsmith.store.selectedPackageForEdit;
		if (!pkg) return;

		const query = pkg.isBefore ? upsertPartRemarkBefore : upsertPartRemarkAfter;
		const safeRemark = (row.remark || '').replace(/'/g, "''");

		try {
			await query.run({
				sessionId: COSJS.getSessionId(),
				partId: row.part_id,
				remark: safeRemark
			});

			const updatedParts = (pkg.parts || []).map(function (p) {
				return p.part_id === row.part_id ? { ...p, remark: row.remark } : p;
			});
			await storeValue('selectedPackageForEdit', { ...pkg, parts: updatedParts });

			await getPackageList.run();
			await getBeforePackageList.run();
		} catch (e) {
			showAlert("Gagal simpan remark: " + e.message, "error");
		}
	},

	async onCopyDivisionConfig() {
		const role = appsmith.store.currentUser?.role;
		if (role !== 'COS' && role !== 'ME') { showAlert("Hanya role COS atau ME yang bisa melakukan aksi ini.", "warning"); return; }
		const sourceSessionId = COSJS.getSessionId();
		if (!sourceSessionId) { showAlert("Pilih artikel sumber dulu.", "warning"); return; }
		const src = (getDivisionStatus.data || []).find(s => s.division === 'COS');
		if (!src || src.state === 'NOT_STARTED') { showAlert("Artikel ini belum ada konfigurasi COS untuk dicopy.", "warning"); return; }
		const targets = msel_copyTargetsCOS.selectedOptionValues || [];
		if (targets.length === 0) { showAlert("Pilih minimal 1 artikel target.", "warning"); return; }

		const done = [], skipped = [], errors = [];
		for (const targetSessionId of targets) {
			if (String(targetSessionId) === String(sourceSessionId)) continue;
			try {
				const st = await getDivisionStatusForSession.run({ sessionId: targetSessionId });
				if ((st || []).some(s => s.division === 'COS' && s.state === 'SUBMITTED')) { skipped.push(targetSessionId); continue; }

				await copyCosProcessColumns.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				await copyCOSUnlinkPackages.run({ newSessionId: targetSessionId });
				await copyCOSPackageDelete.run({ newSessionId: targetSessionId });
				const cosMap = await carryOverCOSPkgIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				if (cosMap && cosMap.length > 0) {
					await Promise.all(cosMap.map(m => carryOverCOSPkgAssignIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId, oldPackageId: m.old_package_id, newPackageId: m.new_package_id })));
				}
				const bfrMap = await carryOverBfrPkgIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId });
				if (bfrMap && bfrMap.length > 0) {
					await Promise.all(bfrMap.map(m => carryOverBfrPkgAssignIngest.run({ oldSessionId: sourceSessionId, newSessionId: targetSessionId, oldPackageId: m.old_package_id, newPackageId: m.new_package_id })));
				}
				// target masuk fase ME: paket dianggap ready + IN_WORK (bukan submit final)
				await submitDivision.run({ sessionId: targetSessionId, division: 'COS', state: 'IN_WORK', submittedBy: appsmith.user.email });
				await markPackagesReady.run({ sessionId: targetSessionId });
				done.push(targetSessionId);
			} catch (e) { errors.push(targetSessionId + ': ' + e.message); }
		}
		await getArticleList.run();
		resetWidget('msel_copyTargetsCOS');
		showAlert(`Copy COS: ${done.length} artikel → siap dialokasi ME (IN_WORK). Dilewati (sudah submit): ${skipped.length}.` + (errors.length ? ' GAGAL: ' + errors.join('; ') : ''), errors.length ? 'error' : 'success');
	},

}