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
};