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

	checkAuthGuard(allowedRoles, requiredClient) {
		const u = appsmith.store.currentUser;
		if (!u || !this.isSessionValid()) {
			storeValue('currentUser', null);
			navigateTo('Login');
			return false;
		}
		if (u.role === 'ADMIN') {
			return true;
		}
		if (allowedRoles && !allowedRoles.includes(u.role)) {
			showAlert("Anda tidak punya akses ke halaman ini", "error");
			navigateTo('Summary Page');
			return false;
		}
		if (requiredClient && u.currentClient !== requiredClient) {
			showAlert("Halaman ini tidak tersedia untuk client Anda saat ini", "error");
			navigateTo('Summary Page');
			return false;
		}
		return true;
	},

	async switchClient(newClient) {
		const u = appsmith.store.currentUser;
		if (!u || !newClient) return;
		if (!u.clients || !u.clients.includes(newClient)) {
			showAlert("Anda tidak punya akses ke client tersebut", "error");
			return;
		}
		await storeValue('currentUser', Object.assign({}, u, { currentClient: newClient }));
		navigateTo('Summary Page');
	}
};