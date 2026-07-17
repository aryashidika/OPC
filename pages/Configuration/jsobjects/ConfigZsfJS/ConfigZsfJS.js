export default {

	// ─────────────────────── Inhouse matching (shared) ───────────────────────
	// Logika yang sama persis dengan ZsfJS.isSupplierInhouse di halaman Leveling.
	// Di-inline ulang di sini karena JSObject tidak bisa dipanggil lintas halaman.
	isSupplierInhouse: function (supplier, matcherRows, module, configType) {
		const patterns = (matcherRows || [])
			.filter(function (r) { return r.module === module && r.config_type === configType; })
			.map(function (r) { return String(r.pattern || '').toLowerCase(); });
		const sup = String(supplier || '').toLowerCase();
		return patterns.some(function (p) { return p !== '' && sup.indexOf(p) !== -1; });
	},

	// Label deteksi untuk satu nama supplier — dipakai penguji (Tab Inhouse Matcher)
	// dan kolom "Deteksi ZSF" di tabel Supplier.
	detectInhouseLabel: function (supplierName) {
		const rows = getInhouseMatcherList.data || [];
		const name = String(supplierName || '').trim();
		if (name === '') return '—';
		const isp = ConfigZsfJS.isSupplierInhouse(name, rows, 'PRB', 'ISP');
		const sb  = ConfigZsfJS.isSupplierInhouse(name, rows, 'PRB', 'SB');
		const hit = [];
		if (isp) hit.push('Inhouse (ISP)');
		if (sb)  hit.push('Inhouse (SB)');
		return hit.length > 0 ? hit.join(' + ') : 'Subcont';
	},

	// Teks hasil penguji, lengkap dengan pola yang cocok.
	getMatcherTestResult: function () {
		const name = String(inp_testSupplierName.text || '').trim();
		if (name === '') return 'Ketik nama supplier untuk menguji.';

		const rows = getInhouseMatcherList.data || [];
		const low = name.toLowerCase();

		const matched = function (cfgType) {
			return rows
				.filter(function (r) {
					return r.module === 'PRB'
						&& r.config_type === cfgType
						&& String(r.pattern || '') !== ''
						&& low.indexOf(String(r.pattern).toLowerCase()) !== -1;
				})
				.map(function (r) { return r.pattern; });
		};

		const ispHits = matched('ISP');
		const sbHits  = matched('SB');

		const line = function (label, hits) {
			return hits.length > 0
				? label + ' : INHOUSE  (cocok pola: ' + hits.join(', ') + ')'
				: label + ' : SUBCONT  (tidak ada pola yang cocok)';
		};

		return 'Hasil untuk "' + name + '"\n'
			+ line('ISP (Incoming Subcont / upper)', ispHits) + '\n'
			+ line('SB  (Stockfitting / treatment bottom)', sbHits);
	},

	// ─────────────────────── ZSF Static (zsf_matgroup) ───────────────────────

	// Semua process_type yang benar-benar dihasilkan getLevelingForZsf dan di-route
	// ke zsf_matgroup (static). Tiga yang lain (INCOMING SUBCONT, TREATMENT BOTTOM,
	// STOCKFITTING BOTTOM) di-route ke tabel ISP/SB, jadi TIDAK termasuk di sini.
	STATIC_PROCESS_TYPES: [
		'SEMI F/G SHOES',
		'SEMI F/G UPPER',
		'SEMI F/G UPPER FEEDING SETTING',
		'SEMI F/G CUTTING INLINE',
		'CUTTING BOOTIE',
		'CUTTING SENTRAL',
		'CUTTING COMPONENT',
		'COS AFTER TREATMENT',
		'SOCKLINER SUBCONT'
	],

	getStaticProcessTypeOptions: function () {
		return ConfigZsfJS.STATIC_PROCESS_TYPES.map(function (pt) {
			return { label: pt, value: pt };
		});
	},

	checkStaticCoverage: function () {
		const rows = getZsfStaticList.data || [];
		const have = rows.map(function (r) {
			return String(r.process_type || '').trim().toUpperCase();
		});
		const missing = ConfigZsfJS.STATIC_PROCESS_TYPES.filter(function (pt) {
			return have.indexOf(pt) === -1;
		});
		if (missing.length === 0) {
			return '✓ Semua process_type yang dihasilkan leveling punya baris config.';
		}
		return '⚠ Tidak punya baris config: ' + missing.join(' · ')
			+ '\nNode dengan tipe ini akan HILANG dari file ZSF (tanpa error).';
	},

	onSaveStaticRow: async function (isNew) {
		const edited = isNew ? tblZsfStatic.newRow : tblZsfStatic.triggeredRow;
		const pt = String(edited.process_type || '').trim().toUpperCase();

		if (pt === '') {
			showAlert("Process Type wajib diisi.", "warning");
			return;
		}
		if (ConfigZsfJS.STATIC_PROCESS_TYPES.indexOf(pt) === -1) {
			showAlert("Process Type '" + pt + "' tidak pernah dihasilkan leveling — baris ini tidak akan pernah terpakai.", "warning");
			return;
		}

		// duplikat process_type
		const dup = (getZsfStaticList.data || []).find(function (r) {
			return String(r.process_type || '').trim().toUpperCase() === pt
				&& r.id !== edited.id;
		});
		if (dup) {
			showAlert("Process Type '" + pt + "' sudah punya baris (id " + dup.id + "). Satu tipe hanya boleh satu baris.", "error");
			return;
		}

		try {
			if (isNew) { await saveZsfStaticNew.run(); } else { await updateZsfStatic.run(); }
			await getZsfStaticList.run();
			showAlert("Tersimpan.", "success");
		} catch (e) {
			showAlert("Gagal simpan: " + e.message, "error");
		}
	},

	onDeleteStaticRow: async function () {
		try {
			await deleteZsfStatic.run();
			await getZsfStaticList.run();
			showAlert("Baris dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	// ──────────── ZSF Dinamis (zsf_matgroup_isp / zsf_matgroup_sb) ────────────

	// Deteksi CELAH pada bucket LT. (JSZsfValidator hanya mendeteksi tumpang tindih.)
	checkLtCoverage: function (rows) {
		const report = [];

		[true, false].forEach(function (inhouse) {
			const label = inhouse ? 'Inhouse' : 'Subcont';
			const buckets = (rows || [])
				.filter(function (r) { return !!r.is_inhouse === inhouse; })
				.map(function (r) {
					return {
						lo: (r.lt_min === null || r.lt_min === undefined) ? -Infinity : Number(r.lt_min),
						hi: (r.lt_max === null || r.lt_max === undefined) ?  Infinity : Number(r.lt_max)
					};
				})
				.sort(function (a, b) { return a.lo - b.lo; });

			if (buckets.length === 0) {
				report.push('⚠ ' + label + ' : tidak ada bucket sama sekali — semua node ' + label + ' akan HILANG dari ZSF.');
				return;
			}

			const shown = buckets.map(function (b) {
				return '[' + (b.lo === -Infinity ? '0' : b.lo) + '–' + (b.hi === Infinity ? '∞' : b.hi) + ']';
			}).join(' ');

			const problems = [];
			if (buckets[0].lo > 0) {
				problems.push('celah di LT 0–' + (buckets[0].lo - 1));
			}
			for (let i = 1; i < buckets.length; i++) {
				const prevHi = buckets[i - 1].hi;
				const curLo  = buckets[i].lo;
				if (prevHi === Infinity) break;
				if (curLo > prevHi + 1) {
					problems.push('celah di LT ' + (prevHi + 1) + '–' + (curLo - 1));
				} else if (curLo <= prevHi) {
					problems.push('tumpang tindih di LT ' + curLo + '–' + prevHi);
				}
			}
			const maxHi = buckets[buckets.length - 1].hi;
			if (maxHi !== Infinity) {
				problems.push('tidak ada bucket untuk LT > ' + maxHi);
			}

			report.push(
				(problems.length === 0 ? '✓ ' : '⚠ ') + label + ' : ' + shown
				+ (problems.length === 0 ? '  lengkap' : '\n     ' + problems.join(' · ') + ' — node dengan LT tsb akan HILANG dari ZSF.')
			);
		});

		return report.join('\n');
	},

	checkIspCoverage: function () { return ConfigZsfJS.checkLtCoverage(getZsfIspList.data || []); },
	checkSbCoverage:  function () { return ConfigZsfJS.checkLtCoverage(getZsfSbList.data  || []); },

	onSaveIspRow: async function (isNew) {
		const rows = getZsfIspList.data || [];
		const edited = isNew ? tblZsfIsp.newRow : tblZsfIsp.triggeredRow;
		const clash = JSZsfValidator.validateLtOverlap(rows, edited);
		if (clash.length > 0) {
			const c = clash[0];
			showAlert(
				"Bucket LT tumpang tindih dengan baris id " + c.id
				+ " (" + (c.is_inhouse ? 'Inhouse' : 'Subcont') + ", LT "
				+ (c.lt_min ?? 0) + "–" + (c.lt_max ?? '∞') + "). Perbaiki dulu.",
				"error"
			);
			return;
		}
		try {
			if (isNew) { await saveZsfIspNew.run(); } else { await updateZsfIsp.run(); }
			await getZsfIspList.run();
			showAlert("Tersimpan.", "success");
		} catch (e) {
			showAlert("Gagal simpan: " + e.message, "error");
		}
	},

	onSaveSbRow: async function (isNew) {
		const rows = getZsfSbList.data || [];
		const edited = isNew ? tblZsfSb.newRow : tblZsfSb.triggeredRow;
		const clash = JSZsfValidator.validateLtOverlap(rows, edited);
		if (clash.length > 0) {
			const c = clash[0];
			showAlert(
				"Bucket LT tumpang tindih dengan baris id " + c.id
				+ " (" + (c.is_inhouse ? 'Inhouse' : 'Subcont') + ", LT "
				+ (c.lt_min ?? 0) + "–" + (c.lt_max ?? '∞') + "). Perbaiki dulu.",
				"error"
			);
			return;
		}
		try {
			if (isNew) { await saveZsfSbNew.run(); } else { await updateZsfSb.run(); }
			await getZsfSbList.run();
			showAlert("Tersimpan.", "success");
		} catch (e) {
			showAlert("Gagal simpan: " + e.message, "error");
		}
	},

	onDeleteIspRow: async function () {
		try {
			await deleteZsfIsp.run();
			await getZsfIspList.run();
			showAlert("Baris dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	onDeleteSbRow: async function () {
		try {
			await deleteZsfSb.run();
			await getZsfSbList.run();
			showAlert("Baris dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus: " + e.message, "error");
		}
	},

	// ───────────────────────────── tab loaders ─────────────────────────────

	onTabInhouseMatcher: async function () {
		await getInhouseMatcherList.run();
	},

	onTabZsfStatic: async function () {
		await getZsfStaticList.run();
	},

	onTabZsfDinamis: async function () {
		await Promise.all([getZsfIspList.run(), getZsfSbList.run()]);
	}

}