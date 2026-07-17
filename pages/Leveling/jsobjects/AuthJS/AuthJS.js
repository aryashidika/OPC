export default {
	async onLogin() {
		const username = custom_login.model.username?.trim();
		const password = custom_login.model.password;
		if (!username || !password) {
			showAlert("Username dan password wajib diisi", "warning");
			return;
		}
		try {
			const result = await loginUser.run({ username, password });
			if (!result || result.length === 0) {
				showAlert("Username atau password salah", "error");
				return;
			}
			const user = result[0];
			await storeValue('currentUser', {
				id: user.id,
				username: user.username,
				display_name: user.display_name,
				role: user.role,
				loginAt: Date.now()
			});
			navigateTo('Summary Page');
		} catch (e) {
			showAlert("Gagal login: " + e.message, "error");
		}
	},

	onLogout() {
		storeValue('currentUser', null);
		navigateTo('Login');
	},

	isSessionValid() {
		const u = appsmith.store.currentUser;
		const SESSION_HOURS = 12;
		return !!(u && u.loginAt && (Date.now() - u.loginAt) <= SESSION_HOURS * 3600 * 1000);
	},

	checkAuthGuard(allowedRoles) {
		const u = appsmith.store.currentUser;
		if (!u || !this.isSessionValid()) {
			storeValue('currentUser', null);
			navigateTo('Login');
			return;
		}
		if (allowedRoles && !allowedRoles.includes(u.role)) {
			showAlert("Anda tidak punya akses ke halaman ini", "error");
			navigateTo('Summary Page');
		}
	}
};