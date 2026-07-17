export default {

	_editMode: false,
	_editId: null,
	_editOriginalName: null,
	_pendingRules: [],

	LEVELING_BEHAVIORS: [
		'INLINE_GROUP',
		'FEEDING_GROUP',
		'NORMAL_CUTTING',
		'WIP_CHAIN',
		'LAMINATION',
		'PASSTHROUGH'
	],

	GROUP_BEHAVIORS: ['INLINE_GROUP', 'FEEDING_GROUP'],

	ANCHORS: ['FG', 'S', 'SU', 'FS', 'SP'],

	CONDITIONS: [
		{ label: 'Tanpa kondisi (default)', value: 'default',          key: null,       val: null },
		{ label: 'cos_type = CENTRAL',      value: 'cos_type_CENTRAL', key: 'cos_type', val: 'CENTRAL' },
		{ label: 'cos_type = LINE',         value: 'cos_type_LINE',    key: 'cos_type', val: 'LINE' },
		{ label: 'in_wip = true',           value: 'in_wip_true',      key: 'in_wip',   val: true },
		{ label: 'in_wip = false',          value: 'in_wip_false',     key: 'in_wip',   val: false }
	],

	DIVISION_LABELS: {
		BLACKBOX:           'Blackbox (Laminating)',
		COMMERZ:            'Commerz (Cutting)',
		COS:                'COS (Computer Stitching)',
		UPPER_TOOLING:      'Upper Tooling (UT)',
		BOTTOM_ENGINEERING: 'Bottom Engineering (BE)'
	},

	WIP_BEHAVIOR_LABELS: {
		LAMINATION:        'Laminasi',
		CUTTING_NORMAL:    'Cutting Normal',
		CUTTING_INLINE:    'Cutting Inline',
		BOOTIE:            'Bootie',
		STITCHING:         'Stitching',
		TREATMENT_SUBCONT: 'Treatment Subcont'
	},

	LEVELING_EFFECT_LABELS: {
		INLINE_GROUP:  'Grup Cutting Inline',
		FEEDING_GROUP: 'Grup Feeding / Bootie'
	},

	isGroupBehavior: function (levelingBehavior) {
		return CatalogConfigJS.GROUP_BEHAVIORS.indexOf(levelingBehavior) !== -1;
	},

	formatParentRules: function (parentRules) {
		if (!parentRules || parentRules.length === 0) return '—';
		return parentRules.map(function (r) {
			if (r.default) return 'default → ' + r.anchor;
			if (r.if) {
				const k = Object.keys(r.if)[0];
				return k + ' = ' + String(r.if[k]).toUpperCase() + ' → ' + r.anchor;
			}
			return '? → ' + r.anchor;
		}).join(' ; ');
	},

	getCatalogRows: function () {
		const all = getCatalogAll.data || [];
		const q = String(inp_searchCatalog.text || '').trim().toLowerCase();
		const div = sel_filterDivision.selectedOptionValue || 'ALL';
		const hideInactive = sw_hideInactive.isSwitchedOn;

		return all
			.filter(function (r) {
			if (hideInactive && !r.is_active) return false;
			if (div !== 'ALL' && r.division !== div) return false;
			if (q) {
				const hay = (String(r.process_name || '') + ' ' + String(r.leveling_code || '')).toLowerCase();
				if (hay.indexOf(q) === -1) return false;
			}
			return true;
		})
			.map(function (r) {
			const isGrp = CatalogConfigJS.isGroupBehavior(r.leveling_behavior);
			return {
				id: r.id,
				division: r.division,
				is_active: r.is_active,
				division_label:     CatalogConfigJS.DIVISION_LABELS[r.division] || r.division,
				process_name:       r.process_name,
				lt_display:         (r.default_lead_time_days === null || r.default_lead_time_days === undefined)
				? '—' : (r.default_lead_time_days + ' hari'),
				wip_behavior_label: CatalogConfigJS.WIP_BEHAVIOR_LABELS[r.wip_behavior] || r.wip_behavior,
				leveling_effect:    isGrp
				? CatalogConfigJS.LEVELING_EFFECT_LABELS[r.leveling_behavior]
				: '— (tidak membentuk grup)',
				leveling_code:      isGrp ? (r.leveling_code || '—') : '—',
				parent_rules_label: isGrp ? CatalogConfigJS.formatParentRules(r.parent_rules) : '—',
				status_label:       r.is_active ? 'Aktif' : 'Nonaktif'
			};
		});
	},

	getDivisionFilterOptions: function () {
		const opts = [{ label: 'Semua Divisi', value: 'ALL' }];
		Object.keys(CatalogConfigJS.DIVISION_LABELS).forEach(function (k) {
			opts.push({ label: CatalogConfigJS.DIVISION_LABELS[k], value: k });
		});
		return opts;
	},

	getLevelingBehaviorOptions: function () {
		const LABELS = { WIP_CHAIN: 'Package Chain' };
		return CatalogConfigJS.LEVELING_BEHAVIORS.map(function (b) {
			return { label: LABELS[b] || b, value: b };
		});
	},

	getAnchorOptions: function () {
		return CatalogConfigJS.ANCHORS.map(function (a) {
			return { label: a, value: a };
		});
	},

	getConditionOptions: function () {
		return CatalogConfigJS.CONDITIONS.map(function (c) {
			return { label: c.label, value: c.value };
		});
	},

	onPageLoad: async function () {
		const u = appsmith.store.currentUser;
		const SESSION_HOURS = 12;
		const expired = !u || !u.loginAt || (Date.now() - u.loginAt) > SESSION_HOURS * 3600 * 1000;
		if (expired) {
			await storeValue('currentUser', null);
			navigateTo('Login');
			return;
		}
		if (!['SPECSHEET_ADMIN', 'SPECSHEET_STAFF', 'ADMIN'].includes(u.role)) {
			showAlert("Anda tidak punya akses ke halaman ini", "error");
			navigateTo('Summary Page');
			return;
		}

		await getCatalogAll.run();
		await getInhouseMatcherList.run();
	},

	buildParentRulesJSON: function () {
		return CatalogConfigJS._pendingRules.map(function (rule) {
			if (rule.condition === 'default') {
				return { default: true, anchor: rule.anchor };
			}
			const cond = CatalogConfigJS.CONDITIONS.find(function (c) {
				return c.value === rule.condition;
			});
			if (!cond || !cond.key) {
				return { default: true, anchor: rule.anchor };
			}
			const ifObj = {};
			ifObj[cond.key] = cond.val;
			return { if: ifObj, anchor: rule.anchor };
		});
	},

	parseParentRulesToPending: function (parentRules) {
		if (!parentRules || parentRules.length === 0) return [];
		return parentRules.map(function (rule, idx) {
			if (rule.default) {
				return { id: idx, condition: 'default', anchor: rule.anchor };
			}
			if (rule.if) {
				const key = Object.keys(rule.if)[0];
				const val = rule.if[key];
				const cond = CatalogConfigJS.CONDITIONS.find(function (c) {
					return c.key === key && String(c.val) === String(val);
				});
				return {
					id: idx,
					condition: cond ? cond.value : 'default',
					anchor: rule.anchor
				};
			}
			return { id: idx, condition: 'default', anchor: rule.anchor };
		});
	},

	getPendingRulesDisplay: function () {
		return CatalogConfigJS._pendingRules.map(function (rule) {
			return {
				id: rule.id,
				condition: rule.condition,
				anchor: rule.anchor
			};
		});
	},

	onSaveRule: function (row) {
		if (!row) return;
		CatalogConfigJS._pendingRules = CatalogConfigJS._pendingRules.map(function (r) {
			if (r.id === row.id) {
				return { id: r.id, condition: row.condition, anchor: row.anchor };
			}
			return r;
		});
		storeValue('catalogRulesVersion', (appsmith.store.catalogRulesVersion || 0) + 1);
	},

	onAddRuleRow: function (newRow) {
		const ids = CatalogConfigJS._pendingRules.map(function (r) { return r.id; });
		const nextId = ids.length === 0 ? 0 : Math.max.apply(null, ids) + 1;
		CatalogConfigJS._pendingRules = CatalogConfigJS._pendingRules.concat([{
			id: nextId,
			condition: (newRow && newRow.condition) || 'default',
			anchor:    (newRow && newRow.anchor)    || 'FS'
		}]);
		storeValue('catalogRulesVersion', (appsmith.store.catalogRulesVersion || 0) + 1);
	},

	onRemoveRule: function (ruleId) {
		CatalogConfigJS._pendingRules = CatalogConfigJS._pendingRules.filter(function (r) {
			return r.id !== ruleId;
		});
		storeValue('catalogRulesVersion', (appsmith.store.catalogRulesVersion || 0) + 1);
	},

	onOpenAddModal: async function () {
		CatalogConfigJS._editMode = false;
		CatalogConfigJS._editId = null;
		CatalogConfigJS._editOriginalName = null;
		CatalogConfigJS._pendingRules = [];
		await storeValue('catalogEditProcessName', '');
		await storeValue('catalogEditDivision', '');
		await storeValue('catalogEditWipBehavior', '');
		await storeValue('catalogEditLevelingBehavior', '');
		await storeValue('catalogEditLevelingCode', '');
		await storeValue('catalogEditDefaultLeadTime', '');
		await storeValue('catalogEditIsActive', true);
		await storeValue('catalogRenameConfirmed', false);
		await storeValue('catalogRulesVersion', (appsmith.store.catalogRulesVersion || 0) + 1);
		showModal('mdl_catalogEdit');
	},

	onOpenEditModal: async function (row) {
		if (!row || !row.id) {
			showAlert("Data tidak valid.", "warning");
			return;
		}

		await getCatalogAll.run();

		const fullData = (getCatalogAll.data || []).find(function (p) {
			return p.id === row.id;
		});

		if (!fullData) {
			showAlert("Data tidak ditemukan.", "error");
			return;
		}

		CatalogConfigJS._editMode = true;
		CatalogConfigJS._editId = fullData.id;
		CatalogConfigJS._editOriginalName = fullData.process_name;
		CatalogConfigJS._pendingRules = CatalogConfigJS.parseParentRulesToPending(fullData.parent_rules);

		await storeValue('catalogEditProcessName', fullData.process_name);
		await storeValue('catalogEditDivision', fullData.division);
		await storeValue('catalogEditWipBehavior', fullData.wip_behavior);
		await storeValue('catalogEditLevelingBehavior', fullData.leveling_behavior);
		await storeValue('catalogEditLevelingCode', fullData.leveling_code || '');
		await storeValue('catalogEditDefaultLeadTime',
										 (fullData.default_lead_time_days === null || fullData.default_lead_time_days === undefined)
										 ? '' : String(fullData.default_lead_time_days));
		await storeValue('catalogEditIsActive', fullData.is_active);
		await storeValue('catalogRenameConfirmed', false);
		await storeValue('catalogRulesVersion', (appsmith.store.catalogRulesVersion || 0) + 1);
		showModal('mdl_catalogEdit');
	},

	validate: function (processName, division, wipBehavior, levelingBehavior, levelingCode, defaultLeadTime) {
		if (!processName || processName.trim() === '') {
			showAlert("Nama proses wajib diisi.", "warning"); return false;
		}
		if (!division) {
			showAlert("Divisi wajib dipilih.", "warning"); return false;
		}
		if (!wipBehavior) {
			showAlert("Perilaku Package wajib dipilih.", "warning"); return false;
		}
		if (!levelingBehavior) {
			showAlert("Efek di Leveling wajib dipilih.", "warning"); return false;
		}
		if (CatalogConfigJS.LEVELING_BEHAVIORS.indexOf(levelingBehavior) === -1) {
			showAlert("Efek di Leveling tidak valid.", "warning"); return false;
		}
		if (CatalogConfigJS.isGroupBehavior(levelingBehavior) && (!levelingCode || levelingCode.trim() === '')) {
			showAlert("Kode Node wajib diisi untuk behavior grup.", "warning"); return false;
		}
		if (defaultLeadTime !== '' && defaultLeadTime !== null && defaultLeadTime !== undefined) {
			const n = Number(defaultLeadTime);
			if (isNaN(n) || n < 0 || !Number.isInteger(n)) {
				showAlert("LT Default harus angka bulat ≥ 0, atau dikosongkan.", "warning"); return false;
			}
		}
		const existing = getCatalogAll.data || [];
		const duplicate = existing.find(function (p) {
			return String(p.process_name || '').toLowerCase() === processName.trim().toLowerCase()
			&& p.division === division
			&& p.id !== CatalogConfigJS._editId;
		});
		if (duplicate) {
			showAlert("Proses '" + processName + "' sudah ada di divisi " + division + ".", "warning");
			return false;
		}
		return true;
	},

	onSave: async function () {
		const processName      = inp_processName.text.trim();
		const division         = sel_division.selectedOptionValue;
		const wipBehavior      = sel_wipBehavior.selectedOptionValue;
		const levelingBehavior = sel_levelingBehavior.selectedOptionValue;
		const levelingCode     = String(inp_levelingCode.text || '').trim();
		const defaultLeadTime  = String(inp_defaultLeadTime.text || '').trim();
		const isActive         = sw_isActive.isSwitchedOn;

		if (!CatalogConfigJS.validate(processName, division, wipBehavior, levelingBehavior, levelingCode, defaultLeadTime)) return;

		// Guard: rename memutus join process_name di data session lama
		if (CatalogConfigJS._editMode
				&& CatalogConfigJS._editOriginalName
				&& CatalogConfigJS._editOriginalName !== processName
				&& !appsmith.store.catalogRenameConfirmed) {
			await storeValue('catalogRenameConfirmed', true);
			showAlert(
				"PERINGATAN: nama proses ini tersimpan di data session lama. Menggantinya membuat LT default artikel lama hilang (jadi '—'). Klik Simpan sekali lagi untuk melanjutkan.",
				"warning"
			);
			return;
		}

		const isGrp = CatalogConfigJS.isGroupBehavior(levelingBehavior);
		const codeToSave = isGrp ? levelingCode : '';
		const parentRulesJSON = JSON.stringify(isGrp ? CatalogConfigJS.buildParentRulesJSON() : []);

		try {
			if (CatalogConfigJS._editMode) {
				await updateCatalogProcess.run({
					id: CatalogConfigJS._editId,
					processName: processName,
					division: division,
					wipBehavior: wipBehavior,
					levelingBehavior: levelingBehavior,
					levelingCode: codeToSave,
					defaultLeadTime: defaultLeadTime,
					parentRules: parentRulesJSON,
					isActive: isActive
				});
				showAlert("Proses berhasil diupdate.", "success");
			} else {
				await insertCatalogProcess.run({
					processName: processName,
					division: division,
					wipBehavior: wipBehavior,
					levelingBehavior: levelingBehavior,
					levelingCode: codeToSave,
					defaultLeadTime: defaultLeadTime,
					parentRules: parentRulesJSON,
					isActive: isActive
				});
				showAlert("Proses baru berhasil ditambahkan.", "success");
			}
			await storeValue('catalogRenameConfirmed', false);
			closeModal('mdl_catalogEdit');
			await getCatalogAll.run();
		} catch (e) {
			showAlert("Gagal simpan: " + e.message, "error");
		}
	},

	onToggleActive: async function (id, currentActive) {
		const all = getCatalogAll.data || [];
		const row = all.find(function (p) { return p.id === id; });

		if (row && currentActive
				&& row.wip_behavior === 'TREATMENT_SUBCONT'
				&& row.division === 'UPPER_TOOLING') {
			await countActiveTreatmentUT.run();
			const n = (countActiveTreatmentUT.data || [{}])[0]?.n ?? 0;
			if (n <= 1) {
				showAlert("Tidak bisa dinonaktifkan: ini satu-satunya proses Treatment Subcont aktif untuk UT. UT tidak akan bisa membuat package.", "error");
				return;
			}
		}

		try {
			await toggleCatalogActive.run({ id: id, isActive: !currentActive });
			await getCatalogAll.run();
			showAlert("Proses " + (!currentActive ? "diaktifkan" : "dinonaktifkan") + ".", "success");
		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	}

}