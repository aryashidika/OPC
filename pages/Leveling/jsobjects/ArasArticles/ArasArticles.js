export default {
	async getByArticleNumber (articleCode, season) {
		const filters = [`article_number/article_number eq '${String(articleCode).replace(/'/g, "''")}'`];
		if (season) {
			filters.push(`season eq '${String(season).replace(/'/g, "''")}'`);
		}

		const queries = {
			$select: "id,article_number,season",
			$expand: "article_number($expand=model_number)",
			$filter: filters.join(" and "),
			$top: 1
		}

		const response_data = await ArasApi.get("C_Entry", queries)
		const data = response_data.value ?? []
		return data[0] ?? null
	}
}