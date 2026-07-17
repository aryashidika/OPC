export default {
	ARAS_GRANT_TYPE: "password",
	ARAS_CLIENT_ID: "AppSmith",
	ARAS_SCOPE: "openid Innovator offline_access",
	ARAS_DATABASE: "InnovatorSolutions",
	ARAS_USERNAME: "plmapi",
	ARAS_PASSWORD: "bFiFWgwKwAqolPxy",

  BEARER_TOKEN: `Bearer ${appsmith.store['aras_access_token']}`,
  IS_AUTHENTICATED: Date.now() < appsmith.store['aras_token_expires_at'],

  storeToken({ access_token, expires_in, token_type, refresh_token, scope }) {
    const expires_at = Date.now() + (expires_in * 1000);
    storeValue('aras_access_token',    access_token);
    storeValue('aras_token_expires_in', expires_in);
    storeValue('aras_token_type',      token_type);
    storeValue('aras_refresh_token',   refresh_token);
    storeValue('aras_token_scope',     scope);
    storeValue('aras_token_expires_at', expires_at);
  },

  clearToken() {
    removeValue('aras_access_token');
    removeValue('aras_token_expires_in');
    removeValue('aras_token_type');
    removeValue('aras_refresh_token');
    removeValue('aras_token_scope');
    removeValue('aras_token_expires_at');
  },

  async generateToken() {
    this.clearToken();
    const data = await ArasGenerateToken.run();
    this.storeToken(data);
    return data;
  },

  async ensureAuthenticated() {
    if (!this.IS_AUTHENTICATED) {
      await this.generateToken();
    }
  },
}