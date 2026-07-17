export default {
	toQueryString(params) {
		return Object.entries(params)
			.filter(([, value]) => value !== undefined && value !== null)
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join("&")
	}
}