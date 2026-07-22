export default {
	ROLES: [
		'ADMIN', 'DEVELOPER', 'SPECSHEET_ADMIN', 'SPECSHEET_STAFF', 'ME',
		'BLACKBOX', 'COMMERZ', 'COS', 'UPPER_TOOLING', 'BOTTOM_ENGINEERING'
	],

	getRoleOptions() {
		return this.ROLES.map(function (r) { return { label: r, value: r }; });
	},

	_validate(row) {
		const nik = String(row.username || '').trim();
		if (nik === '') { showAlert("NIK (username) wajib diisi.", "warning"); return null; }
		if (String(row.display_name || '').trim() === '') { showAlert("Nama wajib diisi.", "warning"); return null; }
		if (this.ROLES.indexOf(row.role) === -1) { showAlert("Role tidak valid.", "warning"); return null; }
		if (!row.has_prb && !row.has_pbb) {
			showAlert("Pilih minimal satu client, kalau tidak user tidak bisa login.", "warning");
			return null;
		}
		return {
			username: nik,
			displayName: String(row.display_name).trim(),
			role: row.role,
			isActive: row.is_active === true,
			hasPrb: row.has_prb === true,
			hasPbb: row.has_pbb === true
		};
	},

	async onSaveUserRow(isNew) {
		const raw = isNew ? tblUser.newRow : tblUser.updatedRow;
		const v = this._validate(raw);
		if (!v) return;

		const clash = (getUserList.data || []).find(function (u) {
			return u.username === v.username && (isNew || u.id !== raw.id);
		});
		if (clash) { showAlert("NIK " + v.username + " sudah terdaftar.", "error"); return; }

		try {
			let userId;
			if (isNew) {
				const res = await insertUser.run(v);
				userId = (res || [{}])[0].id;
				if (!userId) { showAlert("Gagal membuat user.", "error"); return; }
			} else {
				userId = raw.id;
				await updateUser.run(Object.assign({ id: userId }, v));
			}
			await syncUserClients.run({ userId: userId, hasPrb: v.hasPrb, hasPbb: v.hasPbb });
			await getUserList.run();
			showAlert(isNew ? "User ditambahkan." : "User disimpan.", "success");
		} catch (e) {
			showAlert("Gagal simpan: " + e.message, "error");
		}
	},

	async onDeleteUser(row) {
		const u = appsmith.store.currentUser;
		if (!u || u.role !== 'ADMIN') { showAlert("Hanya ADMIN yang boleh menghapus user.", "error"); return; }
		if (row.username === u.username) { showAlert("Tidak bisa menghapus akun Anda sendiri.", "error"); return; }
		try {
			await deleteUser.run({ id: row.id });   // konfirmasi muncul dari setting query
			await getUserList.run();
			showAlert("User dihapus.", "success");
		} catch (e) {
			showAlert("Gagal hapus (kemungkinan masih direferensikan data lain): " + e.message, "error");
		}
	}
};