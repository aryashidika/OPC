export default {
	ARAS_API_BASE_URL: `${ArasConsts.ARAS_URL}/Server/OData`,
	async get (uri, queries) {
		if (!ArasAuth.IS_AUTHENTICATED) {
			await ArasAuth.generateToken()
		}

		let url = `${this.ARAS_API_BASE_URL}/${uri}`

		if (!_.isEmpty(queries)) {
			url = `${url}?${ArasUtils.toQueryString(queries)}`
		}

		const response = await fetch(url, {
			method: "GET",
			headers: {
				"Authorization": ArasAuth.BEARER_TOKEN,
				"Accept": "application/json"
			},
		})

		const response_data = await response.json()

		return response_data
	}
}