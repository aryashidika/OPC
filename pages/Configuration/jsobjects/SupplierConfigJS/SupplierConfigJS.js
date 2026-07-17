export default {

	_editMode: false,
	_editId: null,
	_editOriginalName: null,

	CATEGORIES: ['UPPER', 'OUTSOLE', 'SOCKLINER'],

	getCategoryOptions: function () {
		return [
			{ label: 'Upper (UT)',            value: 'UPPER' },
			{ label: 'Outsole (BE)',          value: 'OUTSOLE' },
			{ label: 'Sockliner (BE)',        value: 'SOCKLINER' }
		];
	},

	getSupplierRows: function () {
		const all = getSupplierAll.data || [];
		const q = String(inp_searchSupplier.text || '').trim().toLowerCase();
		const hideInactive = sw_hideInactiveSupplier.isSwitchedOn;

		return all
			.filter(function (r) {
				if (hideInactive && !r.is_active) return false;
				if (q && String(r.name || '').toLowerCase().indexOf(q) === -1) return false;
				return true;
			})
			.map(function (r) {
				return {
					id: r.id,
					name: r.name,
					is_active: r.is_active,
					categories_label: r.categories && r.categories !== '' ? r.categories : '— (belum ada kategori)',
					inhouse_label: ConfigZsfJS.detectInhouseLabel(r.name),
					status_label: r.is_active ? 'Aktif' : 'Nonaktif'
				};
			});
	},

	// preview live di modal
	getInhousePreview: function () {
		const name = String(inp_supplierName.text || '').trim();
		if (name === '') return '';
		const now = ConfigZsfJS.detectInhouseLabel(name);
		if (!SupplierConfigJS._editMode || !SupplierConfigJS._editOriginalName) {
			return 'Deteksi ZSF untuk nama ini: ' + now;
		}
		const before = ConfigZsfJS.detectInhouseLabel(SupplierConfigJS._editOriginalName);
		if (before === now) {
			return 'Deteksi ZSF: ' + now + ' (tidak berubah)';
		}
		return '⚠ Deteksi ZSF BERUBAH: ' + before + '  →  ' + now
			+ '  — valuation class node yang memakai supplier ini akan berubah di file ZSF.';
	},

	onOpenAddModal: async function () {
		SupplierConfigJS._editMode = false;
		SupplierConfigJS._editId = null;
		SupplierConfigJS._editOriginalName = null;
		await storeValue('supEditName', '');
		await storeValue('supEditCategories', []);
		await storeValue('supEditIsActive', true);
		await storeValue('supRenameConfirmed', false);
		showModal('mdl_supplierEdit');
	},

	onOpenEditModal: async function (row) {
		if (!row || !row.id) { showAlert("Data tidak valid.", "warning"); return; }
		const full = (getSupplierAll.data || []).find(function (s) { return s.id === row.id; });
		if (!full) { showAlert("Supplier tidak ditemukan.", "error"); return; }

		SupplierConfigJS._editMode = true;
		SupplierConfigJS._editId = full.id;
		SupplierConfigJS._editOriginalName = full.name;

		const cats = String(full.categories || '')
			.split(',')
			.map(function (c) { return c.trim(); })
			.filter(function (c) { return c !== ''; });

		await storeValue('supEditName', full.name);
		await storeValue('supEditCategories', cats);
		await storeValue('supEditIsActive', full.is_active);
		await storeValue('supRenameConfirmed', false);
		showModal('mdl_supplierEdit');
	},

	onSaveSupplier: async function () {
		const name = String(inp_supplierName.text || '').trim();
		const cats = sel_supplierCategories.selectedOptionValues || [];
		const isActive = sw_supplierIsActive.isSwitchedOn;

		if (name === '') { showAlert("Nama supplier wajib diisi.", "warning"); return; }
		if (cats.length === 0) {
			showAlert("Pilih minimal satu kategori, kalau tidak supplier ini tidak muncul di dropdown divisi mana pun.", "warning");
			return;
		}

		// duplikat nama
		const dup = (getSupplierAll.data || []).find(function (s) {
			return String(s.name).toLowerCase() === name.toLowerCase()
				&& s.id !== SupplierConfigJS._editId;
		});
		if (dup) { showAlert("Supplier '" + name + "' sudah ada.", "warning"); return; }

		// Guard: rename yang mengubah deteksi ZSF
		if (SupplierConfigJS._editMode
			&& SupplierConfigJS._editOriginalName
			&& SupplierConfigJS._editOriginalName !== name) {
			const before = ConfigZsfJS.detectInhouseLabel(SupplierConfigJS._editOriginalName);
			const after  = ConfigZsfJS.detectInhouseLabel(name);
			if (before !== after && !appsmith.store.supRenameConfirmed) {
				await storeValue('supRenameConfirmed', true);
				showAlert(
					"PERINGATAN: deteksi ZSF berubah dari " + before + " menjadi " + after
					+ ". Valuation class di file ZSF akan ikut berubah. Klik Simpan sekali lagi untuk melanjutkan.",
					"warning"
				);
				return;
			}
		}

		const categories = cats.join(',');

		try {
			if (SupplierConfigJS._editMode) {
				await updateSupplier.run({
					id: SupplierConfigJS._editId,
					name: name,
					categories: categories,
					isActive: isActive
				});
				showAlert("Supplier berhasil diupdate.", "success");
			} else {
				await insertSupplier.run({
					name: name,
					categories: categories,
					isActive: isActive
				});
				showAlert("Supplier baru berhasil ditambahkan.", "success");
			}
			await storeValue('supRenameConfirmed', false);
			closeModal('mdl_supplierEdit');
			await getSupplierAll.run();
		} catch (e) {
			showAlert("Gagal simpan: " + e.message, "error");
		}
	},

	onToggleSupplierActive: async function (id, currentActive) {
		// Guard: menonaktifkan supplier yang masih dipakai package
		if (currentActive) {
			await countSupplierUsage.run({ id: id });
			const n = (countSupplierUsage.data || [{}])[0]?.n ?? 0;
			if (n > 0) {
				showAlert(
					"Tidak bisa dinonaktifkan: supplier ini masih dipakai oleh " + n
					+ " package (upper/bottom). Lepaskan dulu dari package terkait.",
					"error"
				);
				return;
			}
		}
		try {
			await toggleSupplierActive.run({ id: id, isActive: !currentActive });
			await getSupplierAll.run();
			showAlert("Supplier " + (!currentActive ? "diaktifkan" : "dinonaktifkan") + ".", "success");
		} catch (e) {
			showAlert("Gagal: " + e.message, "error");
		}
	},

	onTabSupplier: async function () {
		await getSupplierAll.run();
	}

}