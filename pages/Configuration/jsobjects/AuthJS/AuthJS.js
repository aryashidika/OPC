export default {
	async onPageLoad() {
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
	},

	onLogout() {
		storeValue('currentUser', null);
		navigateTo('Login');
	},
};