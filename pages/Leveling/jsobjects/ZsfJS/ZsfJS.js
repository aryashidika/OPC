export default {
	isSupplierInhouse(supplier, matcherRows, module, configType) {
		const patterns = (matcherRows ?? [])
		.filter(r => r.module === module && r.config_type === configType)
		.map(r => (r.pattern ?? '').toLowerCase());
		const sup = (supplier ?? '').toLowerCase();
		return patterns.some(p => sup.includes(p));
	},

	async fetchZfgDataDc() {
		const [zsfMatgroup, zsfMatgroupIsp, zsfMatgroupSb, zsfMatgroupIbt, inhouseMatcher] = await Promise.all([
			getZsfMatgroup.run(),
			getZsfMatgroupIsp.run(),
			getZsfMatgroupSb.run(),
			getZsfMatgroupIbt.run(),
			getInhouseMatcher.run()
		]);
		return { zsfMatgroup, zsfMatgroupIsp, zsfMatgroupSb, zsfMatgroupIbt, inhouseMatcher };
	},

	generateZsfDcSheet(articleCode, zfgData, levelingData) {
		const { zsfMatgroup, zsfMatgroupIsp, zsfMatgroupSb, zsfMatgroupIbt } = zfgData;

		const getIspConfig = (supplier, lt) => {
			const isInhouse = ZsfJS.isSupplierInhouse(supplier, zfgData.inhouseMatcher, 'PRB', 'ISP');
			const ltNum = lt ?? 0;
			return (zsfMatgroupIsp ?? []).find(r => {
				if (r.is_inhouse !== isInhouse) return false;
				if (r.lt_min !== null && ltNum < r.lt_min) return false;
				if (r.lt_max !== null && ltNum > r.lt_max) return false;
				return true;
			}) ?? null;
		};

		const getSbConfig = (supplier, lt) => {
			const isInhouse = ZsfJS.isSupplierInhouse(supplier, zfgData.inhouseMatcher, 'PRB', 'SB');
			const ltNum = lt ?? 0;
			return (zsfMatgroupSb ?? []).find(r => {
				if (r.is_inhouse !== isInhouse) return false;
				if (r.lt_min !== null && ltNum < r.lt_min) return false;
				if (r.lt_max !== null && ltNum > r.lt_max) return false;
				return true;
			}) ?? null;
		};

		const getIbtConfig = (supplier, lt) => {
			const isInhouse = ZsfJS.isSupplierInhouse(supplier, zfgData.inhouseMatcher, 'PRB', 'IBT');
			const ltNum = lt ?? 0;
			return (zsfMatgroupIbt ?? []).find(r => {
				if (r.is_inhouse !== isInhouse) return false;
				if (r.lt_min !== null && ltNum < r.lt_min) return false;
				if (r.lt_max !== null && ltNum > r.lt_max) return false;
				return true;
			}) ?? null;
		};

		const getStaticConfig = (processType) => {
			return (zsfMatgroup ?? []).find(r =>
																			r.process_type?.trim().toUpperCase() === processType?.trim().toUpperCase()
																		 ) ?? null;
		};

		const headers = [
			'ARTICLE NO','DISTRIBUTION Center','VIEW SELECTION DC1','VIEW SELECTION DC2',
			'LOT Sizing','MAX STOCK','SAFETY','forecast model','PERIOD IND','MRP CONTROLLER',
			'PLN DEL TIME','GR PROC TIME','LOADING Grp','SLOC','AVAIL CHCK','MRP Profile',
			'MRP GRUP','PROC TYPE','SPEC PROC TY','forecast per','Initial IND','AUTO Reset',
			'historical per','Tracklimit','Model Selec','PROFIT CENTR','STRATEGY Grp',
			'Catalog Profile','QM mat. auth.','INSP INTERV','QM System','Doc.Required',
			'Valuation Class','PRICE UNIT','PRICE UNIT','PRICE IND','WAREHOUSE NO','STORG TYPE',
			'Gross Weight','Dimension','Volume','Volume UoM','Withdrawal','UoM','Placement',
			'Allow Pack','Overdely tol.','InhseProdTime','Prodn Supervisor','Prod.Sched.Profile',
			'Underdely tol.','ORIGIN Grp','PRICE INDC','PRICE UNIT','REL ORIGIN','QTY STRUCTUR',
			'Variance Key','Cstg Lot Size','Re-Order Point','Do Not Cost','Purchasing Grp'
		];

		const BASE = [
			null, null, 'X', 'X', null, null, null, 0, 'W', null,
			null, '', '0001', null, '02', null, 'ZSF', null, null, 12,
			'X', 'X', 60, 4, 2, 1100, null, null, null, null,
			null, 'X', null, 1, 1, 'S', null, null, null, 'KG',
			null, null, null, 'PAA', null, 'X', null, '', null, null,
			null, null, 'S', 1, 'X', 'X', 'Z00001', 100, null, null, ''
		];

		const rows = [];
		const structuralNodes = (levelingData ?? []).filter(n =>
																												n.process_code &&
																												n.process_code !== '-' &&
																												n.process_type !== 'RAW MATERIAL' &&
																												n.process_type !== 'FG SHOES'
																											 );

		for (const node of structuralNodes) {
			let cfg = null;
			if (node.process_type === 'INCOMING SUBCONT') {
				cfg = getIspConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else if (node.process_type === 'STOCKFITTING BOTTOM') {
				cfg = getSbConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else if (node.process_type === 'SOCKLINER TREATMENT BOTTOM') {
				cfg = getSbConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else if (node.process_type === 'TREATMENT BOTTOM') {
				cfg = getIbtConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else {
				cfg = getStaticConfig(node.process_type);
			}
			if (!cfg) continue;

			const row1101 = [...BASE];
			row1101[0]  = node.process_code;
			row1101[1]  = 1101;
			row1101[11] = cfg.grt != null ? cfg.grt : '';
			row1101[15] = cfg.mrp;
			row1101[32] = cfg.valclass;
			row1101[47] = cfg.iht != null ? cfg.iht : '';
			row1101[60] = cfg.purgroup != null ? cfg.purgroup : '';

			const row1102 = [...BASE];
			row1102[0]  = node.process_code;
			row1102[1]  = 1102;
			row1102[11] = cfg.grt != null ? cfg.grt : '';
			row1102[15] = null;
			row1102[32] = cfg.valclass;
			row1102[47] = cfg.iht != null ? cfg.iht : '';
			row1102[60] = cfg.purgroup != null ? cfg.purgroup : '';

			rows.push(row1101);
			rows.push(row1102);
		}

		return { headers, rows };
	},

	formatSize(size) {
		return String(size).replace(/(\d+)-([A-Za-z]+)/g, '$1T$2').replace(/(\d+)-$/g, '$1T');
	},

	async fetchZfgDataGen(meta) {
		const base = await ZsfJS.fetchZfgDataDc();
		const [configClassTable, materialGroupTable] = await Promise.all([
			getArasConfigClass.run(),
			getArasMaterialGroup.run()
		]);
		return {
			...base,
			configClassTable: configClassTable,
			materialGroupTable: materialGroupTable,
			productType:    meta.productType    ?? '',
			sportsCategory: meta.sportsCategory ?? '',
			sizePage:       meta.sizePage       ?? '',
			ageGroup:       meta.ageGroup       ?? '',
			modelName:      meta.modelName      ?? '',
			sizes:          meta.sizes          ?? ''
		};
	},

	generateZsfSheet(articleCode, zfgData, levelingData) {
		const { sizePage, ageGroup, configClassTable, zsfMatgroup, zsfMatgroupIsp, zsfMatgroupSb, zsfMatgroupIbt } = zfgData;

		const ccRow = (configClassTable ?? []).find(r =>
																								r.size_page?.trim().toUpperCase() === sizePage?.trim().toUpperCase() &&
																								r.age_group?.trim().toUpperCase() === ageGroup?.trim().toUpperCase()
																							 );
		const configClass = ccRow?.config_class ?? '';
		const sizeList = (zfgData.sizes ?? '').split(',').map(s => s.trim()).filter(s => s !== '');

		const getIspConfig = (supplier, lt) => {
			const isInhouse = ZsfJS.isSupplierInhouse(supplier, zfgData.inhouseMatcher, 'PRB', 'ISP');
			const ltNum = lt ?? 0;
			return (zsfMatgroupIsp ?? []).find(r => {
				if (r.is_inhouse !== isInhouse) return false;
				if (r.lt_min !== null && ltNum < r.lt_min) return false;
				if (r.lt_max !== null && ltNum > r.lt_max) return false;
				return true;
			}) ?? null;
		};
		const getSbConfig = (supplier, lt) => {
			const isInhouse = ZsfJS.isSupplierInhouse(supplier, zfgData.inhouseMatcher, 'PRB', 'SB');
			const ltNum = lt ?? 0;
			return (zsfMatgroupSb ?? []).find(r => {
				if (r.is_inhouse !== isInhouse) return false;
				if (r.lt_min !== null && ltNum < r.lt_min) return false;
				if (r.lt_max !== null && ltNum > r.lt_max) return false;
				return true;
			}) ?? null;
		};
		const getIbtConfig = (supplier, lt) => {
			const isInhouse = ZsfJS.isSupplierInhouse(supplier, zfgData.inhouseMatcher, 'PRB', 'IBT');
			const ltNum = lt ?? 0;
			return (zsfMatgroupIbt ?? []).find(r => {
				if (r.is_inhouse !== isInhouse) return false;
				if (r.lt_min !== null && ltNum < r.lt_min) return false;
				if (r.lt_max !== null && ltNum > r.lt_max) return false;
				return true;
			}) ?? null;
		};
		const getStaticConfig = (processType) => {
			return (zsfMatgroup ?? []).find(r =>
																			r.process_type?.trim().toUpperCase() === processType?.trim().toUpperCase()
																		 ) ?? null;
		};

		const headers = [
			'Material Number','Material Type','Material Group','Configuration Class Type','Material Category',
			'Configuration Class','Check Box','Characteristic Description','Char Value','Material Description',
			'Based UoM','Gross Weight','Net Weight','Length','Weigth','Height','Unit of Dimension','Volume',
			'Volume unit','Pricing profile for variants','Tax classification','Valuation Class','Batch Indicator',
			'Loading Group','General item category group','Valid-From Date','Old Material Number','MLM ID',
			'Tooling ID','Last ID','Period Indicator','Class Type','Class Number','Characteristic Description',
			'Characteristic Value','First entry displayed','Listing Procedure','Date from which listed',
			'Date to which listed','Date from which listed','Date to which listed','Listing Procedure',
			'Date from which listed','Date to which listed','Date from which listed','Date to which listed',
			'Maintain Assortments Manually','Indicator: Perform listing check','List Local Assortments',
			'List Supplying Plant','Site1','Site2','MRP Type','Lot Sizing Procedure','Forecast Model',
			'Period Indicator','MRP Controller','Planned Delivery Time','GR Processing Time','Loading Group',
			'External SLoc','Availability Check','individual & coll. Reqmts','Unit of Measurement',
			'In-house production time','MRP Profile','MRP Group','Procurement Type','Special procurement type',
			'historical periods','Forecast periods','Initialization Indicator','Tracking limit',
			'Model selection procedure','Forecast Model','Planning Strategy Group','Profit Center',
			'Consumption Mode','Documentation Required','Catalog Profile','Authorization Group',
			'Interval Inspection','Valuation Class','Price Determination','Price unit','Price Control',
			'Warehouse Number','Storage Type','Gross Weight','Weight unit','Volume','Volume unit',
			'indicator for stock removal','Indicator for stock placement','Allow addn to stock',
			'Produ.Supervisor','Under.dely tolerance:','Over.dely tolerance:','Prod.Sched.Profile',
			'Article origin','Quantity Structure','Lot Size for Product Costing','Price control indicator',
			'Price unit','Variance Key','Logistics handling group','Batch Management Plant',
			'Plant-Specific Material Status','Purchasing Grp'
		];

		const BASE = [
			null, 'ZSF', null, 300, '01', null, 'X', null, null, null,
			'PAA', null, null, null, null, null, null, null, null, 2,
			0, null, 'X', '0001', 'NORM', '29.11.2021', null, null, null, null,
			null, '023', 'ZPRB_BATCH', null, null, null, '02', '29.11.2021', '31.12.9999', '29.11.2021',
			'31.12.9999', '02', '29.11.2021', '31.12.9999', '29.11.2021', '31.12.9999', 'X', 'X', 'X', 'X',
			1, 8, 'ND', null, 0, 'W', null, '', '', '0001',
			null, '02', null, null, '', null, null, 'X', null, 60,
			12, 'X', 4, 2, 'X', null, 1100, null, 'X', null,
			null, null, null, 2, 1, 'S', null, null, null, 'KG',
			null, null, null, null, 'X', null, null, null, null, 'X',
			'X', 100, 'S', 1, 'Z00001', null, 'X', null, ''
		];

		const rows = [];
		const structuralNodes = (levelingData ?? []).filter(n =>
																												n.process_code &&
																												n.process_code !== '-' &&
																												n.process_type !== 'RAW MATERIAL' &&
																												n.process_type !== 'FG SHOES'
																											 );

		for (const node of structuralNodes) {
			let cfg = null;
			if (node.process_type === 'INCOMING SUBCONT') {
				cfg = getIspConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else if (node.process_type === 'STOCKFITTING BOTTOM') {
				cfg = getSbConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else if (node.process_type === 'SOCKLINER TREATMENT BOTTOM') {
				cfg = getSbConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else if (node.process_type === 'TREATMENT BOTTOM') {
				cfg = getIbtConfig(node.node_supplier, node.lead_time ?? node.node_supplier_lt);
			} else {
				cfg = getStaticConfig(node.process_type);
			}
			if (!cfg) continue;

			const materialDesc = (node.process_type === 'INCOMING SUBCONT' ||
														node.process_type === 'OUTGOING SUBCONT' ||
														node.process_type === 'CUTTING COMPONENT')
			? ((cfg.description ?? '') + (node.part_name ?? '')).toUpperCase()
			: (cfg.description ?? '') + articleCode;

			for (const size of sizeList) {
				const row = [...BASE];
				row[0]   = node.process_code;
				row[2]   = cfg.matgroup;
				row[5]   = configClass;
				row[7]   = configClass;
				row[8]   = ZsfJS.formatSize(size);
				row[9]   = materialDesc;
				row[21]  = cfg.valclass;
				row[57]  = cfg.pdt != null ? cfg.pdt : '';
				row[58]  = cfg.grt != null ? cfg.grt : '';
				row[64]  = cfg.iht != null ? cfg.iht : '';
				row[82]  = cfg.valclass;
				row[108] = cfg.purgroup != null ? cfg.purgroup : '';
				rows.push(row);
			}
		}

		return { headers, rows };
	},

	async downloadZsfExcel() {
		if (!['SPECSHEET_ADMIN', 'SPECSHEET_STAFF', 'ADMIN'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Anda tidak punya akses untuk download ZSF.", "warning");
			return;
		}
		const articleCode = sel_article.selectedOptionValue;
		if (!articleCode) { showAlert("Pilih artikel dulu.", "warning"); return; }

		await getLevelingForZsf.run();
		const nodes = getLevelingForZsf.data || [];
		if (nodes.length === 0) {
			showAlert("Belum ada data leveling untuk artikel ini. Generate dulu.", "warning");
			return;
		}

		const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx/+esm");

		const headers1 = ['level','parent_code','part_id','process_code','part_name','process_type','lead_time'];
		const ws1data = [headers1].concat(nodes.map(function (n) {
			return [n.level ?? '', n.parent_code ?? '', n.part_id ?? '', n.process_code ?? '',
							n.part_name ?? '', n.process_type ?? '', n.lead_time ?? ''];
		}));
		const wb1 = XLSX.utils.book_new();
		const ws1 = XLSX.utils.aoa_to_sheet(ws1data);
		ws1['!cols'] = [{wch:8},{wch:20},{wch:12},{wch:20},{wch:35},{wch:45},{wch:12}];
		XLSX.utils.book_append_sheet(wb1, ws1, 'Leveling');
		const out1 = XLSX.write(wb1, { bookType: 'xlsx', type: 'array' });
		const url1 = URL.createObjectURL(new Blob([out1],
																							{ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
		navigateTo(url1, {}, 'NEW_WINDOW');

		try {
			const meta    = await ZsfJS.fetchArasMeta(articleCode);
			const zfgData = await ZsfJS.fetchZfgDataGen(meta);
			const wb2 = XLSX.utils.book_new();

			const gen = ZsfJS.generateZsfSheet(articleCode, zfgData, nodes);
			const wsGen = XLSX.utils.aoa_to_sheet([gen.headers].concat(gen.rows));
			wsGen['!cols'] = Array(109).fill({ wch: 15 });
			wsGen['!cols'][0] = { wch: 20 }; wsGen['!cols'][5] = { wch: 25 }; wsGen['!cols'][9] = { wch: 40 };
			XLSX.utils.book_append_sheet(wb2, wsGen, 'ZSF GEN');

			const dc = ZsfJS.generateZsfDcSheet(articleCode, zfgData, nodes);
			const wsDc = XLSX.utils.aoa_to_sheet([dc.headers].concat(dc.rows));
			wsDc['!cols'] = Array(61).fill({ wch: 15 });
			wsDc['!cols'][0] = { wch: 20 };
			XLSX.utils.book_append_sheet(wb2, wsDc, 'ZSF DC');

			const out2 = XLSX.write(wb2, { bookType: 'xlsx', type: 'array' });
			const url2 = URL.createObjectURL(new Blob([out2],
																								{ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
			navigateTo(url2, {}, 'NEW_WINDOW');
			showAlert(`ZSF_${articleCode}.xlsx berhasil dibuat.`, "success");
		} catch (e) {
			showAlert("Leveling ter-download, tapi ZSF gagal: " + e.message, "warning");
		}
	},

	async fetchArasMeta(articleCode) {
		await getArticleSeason.run();
		const season = (getArticleSeason.data || [])[0]?.season ?? null;
		const entry = await ArasArticles.getByArticleNumber(articleCode, season);
		if (!entry) throw new Error(`Article ${articleCode} tidak ditemukan di Aras`);
		const modelNum = entry.article_number?.model_number ?? {};
		return {
			productType:    modelNum.product_type    ?? '',
			sportsCategory: modelNum.sports_category ?? '',
			sizePage:       modelNum.size_page       ?? '',
			ageGroup:       modelNum.age_group       ?? '',
			modelName:      modelNum.model_name      ?? '',
			sizes:          modelNum.sizes           ?? ''
		};
	},
}