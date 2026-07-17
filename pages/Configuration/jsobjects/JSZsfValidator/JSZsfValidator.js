export default {
	rangesOverlap(min1, max1, min2, max2) {
		const lo1 = min1 ?? -Infinity;
		const hi1 = max1 ?? Infinity;
		const lo2 = min2 ?? -Infinity;
		const hi2 = max2 ?? Infinity;
		return lo1 <= hi2 && lo2 <= hi1;
	},

	validateLtOverlap(allRows, editedRow) {
		return (allRows ?? []).filter(r =>
			r.id !== editedRow.id &&
			r.is_inhouse === editedRow.is_inhouse &&
			this.rangesOverlap(r.lt_min, r.lt_max, editedRow.lt_min, editedRow.lt_max)
		);
	}
}