export default {
	CLIENT_ID: "PRB-Dev-OPC",
	AUTH_ENDPOINT: "https://sso.panarub.co.id/realms/aci.co.id/protocol/openid-connect/auth",
	REDIRECT_URI: "https://apps.panarub.co.id/app/opc/login-6a4a1f1c3d9aec1fb68eafea/edit/widgets?branch=master",

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
	},

	async redirectToKeycloak() {
		const redirectUri = encodeURIComponent(this.REDIRECT_URI);
		const scope = encodeURIComponent("openid profile email");
		const authUrl = `${this.AUTH_ENDPOINT}?client_id=${this.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
		navigateTo(authUrl, {}, "SAME_WINDOW");
	},

	async checkCallbackAndLogin() {
		const code = appsmith.URL.queryParams.code;
		if (!code) return;

		try {
			showAlert("Otentikasi SSO berhasil, memverifikasi akun Anda...", "info");

			const tokenData = await exchangeCodeForToken.run({ code, redirectUri: this.REDIRECT_URI });
			if (!tokenData || !tokenData.access_token) {
				showAlert("Gagal menukarkan kode otentikasi dari Keycloak.", "error");
				return;
			}

			const keycloakUser = await getUserInfo.run({ accessToken: tokenData.access_token });
			const nik = keycloakUser.preferred_username || keycloakUser.username;
			const email = keycloakUser.email || "";
			const keycloakSub = keycloakUser.sub || "";

			const syncResult = await syncSSOUser.run({ nik, keycloakSub, email });
			if (!syncResult || syncResult.length === 0) {
				showAlert(`Login ditolak. NIK "${nik}" tidak terdaftar atau tidak aktif di whitelist.`, "error");
				return;
			}

			await this.resolveClientAndProceed(syncResult[0]);
		} catch (error) {
			console.log("SSO LOGIN ERROR:", error);
			showAlert("Login gagal. Terjadi kesalahan saat verifikasi.", "error");
		}
	},

	async onPageLoad() {
		await this.checkCallbackAndLogin();
	}
};