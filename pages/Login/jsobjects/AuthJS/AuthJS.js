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
			await this.resolveClientAndProceed(result[0]);
		} catch (e) {
			showAlert("Gagal login: " + e.message, "error");
		}
	},

	async resolveClientAndProceed(user) {
		const clients = await getUserClients.run({ userId: user.id });
		const clientList = (clients || []).map(function (c) { return c.client; });
		if (clientList.length === 0) {
			showAlert("Akun belum punya akses client, hubungi admin", "error");
			return;
		}
		await storeValue('pendingClientList', clientList);
		if (clientList.length === 1) {
			await this.finalizeLogin(user, clientList[0]);
			return;
		}
		await storeValue('pendingLoginUser', user);
		showModal('modal_clientPicker');
	},

	async selectClient(client) {
		const user = appsmith.store.pendingLoginUser;
		if (!user) {
			showAlert("Sesi login kadaluarsa, silakan login ulang", "error");
			closeModal('modal_clientPicker');
			return;
		}
		closeModal('modal_clientPicker');
		await storeValue('pendingLoginUser', null);
		await this.finalizeLogin(user, client);
	},

	async finalizeLogin(user, client) {
		const clientList = appsmith.store.pendingClientList || [client];
		await storeValue('currentUser', {
			id: user.id,
			username: user.username,
			display_name: user.display_name,
			role: user.role,
			currentClient: client,
			clients: clientList,
			loginAt: Date.now()
		});
		await storeValue('pendingClientList', null);
		navigateTo('Summary Page');
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