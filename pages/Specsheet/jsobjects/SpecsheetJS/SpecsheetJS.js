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

		await getSessionList.run();
		await getAllActiveSessions.run();
	},

	getArticleOptions() {
		const sessions = getSessionList.data || [];
		const seen = {};
		const result = [];
		sessions.forEach(function (s) {
			if (!seen[s.article_id]) {
				seen[s.article_id] = true;
				const modelName = s.model_name ? String(s.model_name).trim() : '';
				result.push({
					label: modelName
					? '(' + s.article_id + '): ' + modelName
					: s.article_id,
					value: s.article_id
				});
			}
		});
		return result;
	},

	async onArticleSelect() {
		const articleId = sel_specArticle.selectedOptionValue;
		if (!articleId) return;

		await getSessionList.run();
		await getAggregateStatus.run();
		await getConcernList.run();
		await getPartsForSpecsheet.run();
		await getRevisionList.run();
		await getUntouchedParts.run({ sessionId: this.getActiveSessionId() });
	},

	getActiveSessionInfo() {
		const sessions = getSessionList.data || [];
		const articleId = sel_specArticle.selectedOptionValue;
		if (!articleId) return null;
		return sessions.find(function (s) {
			return s.article_id === articleId && s.is_latest === true;
		}) || null;
	},

	getActiveSessionId() {
		return this.getActiveSessionInfo()?.id ?? null;
	},

	isHiddenSibling(articleId) {
		const sessions = getAllActiveSessions.data || [];
		const target = sessions.find(function (s) { return s.article_id === articleId; });
		if (!target || !target.model_number || target.model_number === '(No Model)') return false;
		const siblings = sessions.filter(function (s) { return s.model_number === target.model_number; });
		const rep = siblings.reduce(function (best, s) {
			return (!best || new Date(s.created_at) < new Date(best.created_at)) ? s : best;
		}, null);
		return !!(rep && rep.article_id !== articleId);
	},

	canRelease() {
		const statuses = getAggregateStatus.data;
		if (!statuses || statuses.length === 0) return false;
		return statuses.every(function (s) {
			return s.state === 'SUBMITTED';
		});
	},

	getReleaseReadiness() {
		const statuses = getAggregateStatus.data;
		if (!statuses || statuses.length === 0) return 'Pilih article dulu.';

		const notSubmitted = statuses.filter(function (s) {
			return s.state !== 'SUBMITTED';
		});

		if (notSubmitted.length === 0) {
			return '✅ Semua divisi submitted. Siap release.';
		}

		return '⏳ Belum submitted: ' +
			notSubmitted.map(function (s) { return s.division; }).join(', ') + '.';
	},

	async onRelease() {
		if (!['SPECSHEET_ADMIN', 'SPECSHEET_STAFF'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role SPECSHEET yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!this.canRelease()) {
			showAlert('Belum siap release.', 'warning');
			return;
		}
		try {
			await releaseSession.run({
				sessionId: this.getActiveSessionId(),
				releasedBy: appsmith.user.email
			});
			await getSessionList.run();
			await getAggregateStatus.run();
			showAlert('Session berhasil di-release! 🎉', 'success');
		} catch (e) {
			showAlert('Gagal release: ' + e.message, 'error');
		}
	},

	async onRaiseConcern(targetDivision, reason, itemRef) {
		if (!['SPECSHEET_ADMIN', 'SPECSHEET_STAFF'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role SPECSHEET yang bisa melakukan aksi ini.", "warning");
			return;
		}
		if (!targetDivision) {
			showAlert('Pilih target divisi.', 'warning');
			return;
		}
		if (!reason || !reason.trim()) {
			showAlert('Alasan concern wajib diisi.', 'warning');
			return;
		}

		const articleId = sel_specArticle.selectedOptionValue;
		if (SpecsheetJS.isHiddenSibling(articleId)) {
			showAlert('Artikel ini bukan representatif model dan tersembunyi dari dropdown ' + targetDivision + '. Setelah concern ini tersimpan, artikel akan otomatis muncul di dropdown divisi tsb.', 'info');
		}

		try {
			await createConcernSpecsheet.run({
				sessionId:      this.getActiveSessionId(),
				targetDivision: targetDivision,
				raisedBy:       appsmith.store.currentUser?.username || 'UNKNOWN',
				reason:         reason.trim(),
				itemRef:        itemRef || ''
			});
			await setDivisionRework.run({
				sessionId: this.getActiveSessionId(),
				division:  targetDivision
			});
			await getConcernList.run();
			await getAggregateStatus.run();
			showAlert('Concern berhasil dibuat, ' + targetDivision + ' → REWORK.', 'success');
		} catch (e) {
			showAlert('Gagal raise concern: ' + e.message, 'error');
		}
	},

	async onCloseConcern(concernId, concernSource) {
		if (!['SPECSHEET_ADMIN', 'SPECSHEET_STAFF'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role SPECSHEET yang bisa melakukan aksi ini.", "warning");
			return;
		}

		if (concernSource === 'SYSTEM') {
			showAlert('Concern sistem hanya bisa ditutup oleh divisi terkait.', 'warning');
			return;
		}
		try {
			await closeConcern.run({
				concernId: concernId,
				closedBy:  appsmith.store.currentUser?.username || 'UNKNOWN',
			});
			await getConcernList.run();
			await getAggregateStatus.run();
			showAlert('Concern ditutup.', 'success');
		} catch (e) {
			showAlert('Gagal tutup concern: ' + e.message, 'error');
		}
	},

	async onCompareRevisions() {
		const rows = tbl_revisionList.selectedRows;
		if (!rows || rows.length !== 2) {
			showAlert('Pilih tepat 2 revisi untuk dibandingkan.', 'warning');
			return;
		}
		const [a, b] = rows.slice().sort(function (x, y) {
			return x.revision_no - y.revision_no;
		});
		await getBOMDelta.run({
			oldSessionId: a.session_id,
			newSessionId: b.session_id
		});
		storeValue('compareOldSessionId', a.session_id);
		storeValue('compareNewSessionId', b.session_id);
		storeValue('compareOldRevNo', a.revision_no);
		storeValue('compareNewRevNo', b.revision_no);
		showModal('mdl_bomDelta');
	},

	getBOMDeltaDisplay() {
		const delta = getBOMDelta.data || [];
		return delta.map(function (p) {
			return {
				part_id:       p.part_id,
				part_name:     p.part_name,
				material_desc: p.material_desc || '-',
				supplier_name: p.supplier_name || '-',
				delta_status:  p.delta_status,
				status_label:  p.delta_status === 'NEW'     ? '➕ Baru'   :
				p.delta_status === 'REMOVED'  ? '➖ Keluar' : '✓ Sama'
			};
		});
	},

	async onViewAssignmentDelta(partId) {
		await getAssignmentDelta.run({
			oldSessionId: appsmith.store.compareOldSessionId,
			newSessionId: appsmith.store.compareNewSessionId,
			partId:       partId
		});
		showModal('mdl_assignmentDelta');
	},

	getAssignmentDeltaDisplay() {
		const delta = getAssignmentDelta.data || [];
		return delta.map(function (d) {
			return {
				attribute:  d.attribute,
				old_value:  d.old_value,
				new_value:  d.new_value,
				is_changed: d.is_changed
			};
		});
	},

	openReworkModal(division, reworkAll) {
		const articleId = sel_specArticle.selectedOptionValue;
		if (SpecsheetJS.isHiddenSibling(articleId)) {
			showAlert('Artikel ini bukan representatif model dan tersembunyi dari dropdown ' + division + '. Setelah REWORK ini tersimpan, artikel akan otomatis muncul di dropdown divisi tsb.', 'info');
		}
		storeValue('reworkTargetDivision', division);
		storeValue('reworkAll', reworkAll || false);
		resetWidget('inp_reworkReason');
		showModal('mdl_reworkConfirm');
	},

	async onReworkDivision() {
		if (!['SPECSHEET_ADMIN', 'SPECSHEET_STAFF'].includes(appsmith.store.currentUser?.role)) {
			showAlert("Hanya role SPECSHEET yang bisa melakukan aksi ini.", "warning");
			return;
		}

		const division = appsmith.store.reworkTargetDivision;
		const reworkAll = appsmith.store.reworkAll;
		const reason = inp_reworkReason.text ? inp_reworkReason.text.trim() : '';

		if (!reason) {
			showAlert('Alasan REWORK wajib diisi.', 'warning');
			return;
		}

		const sessionInfo = SpecsheetJS.getActiveSessionInfo();
		if (!sessionInfo) {
			showAlert('Session tidak ditemukan.', 'error');
			return;
		}

		const statuses = getAggregateStatus.data || [];
		const targets = reworkAll
		? statuses.filter(function (s) { return s.state === 'SUBMITTED'; }).map(function (s) { return s.division; })
		: [division];

		if (targets.length === 0) {
			showAlert('Tidak ada divisi yang bisa di-rework.', 'warning');
			return;
		}

		try {
			await Promise.all(targets.map(function (div) {
				return createConcernSpecsheet.run({
					sessionId:      SpecsheetJS.getActiveSessionId(),
					targetDivision: div,
					raisedBy:       appsmith.store.currentUser?.username || 'UNKNOWN',
					reason:         reason,
					itemRef:        ''
				});
			}));

			await Promise.all(targets.map(function (div) {
				return setDivisionRework.run({
					sessionId: SpecsheetJS.getActiveSessionId(),
					division:  div
				});
			}));

			if (sessionInfo.status === 'RELEASED') {
				await unreleasedSession.run({
					sessionId: SpecsheetJS.getActiveSessionId()
				});
				await getSessionList.run();
			}

			await getConcernList.run();
			await getAggregateStatus.run();
			closeModal('mdl_reworkConfirm');
			showAlert(targets.join(', ') + ' → REWORK. Concern tercatat.', 'success');
		} catch (e) {
			showAlert('Gagal: ' + e.message, 'error');
		}
	},

	async copyProcessToArticles(sourceSessionId, targetSessionIds) {
		if (!sourceSessionId || !targetSessionIds || targetSessionIds.length === 0) {
			showAlert("Pilih artikel sumber dan minimal 1 artikel target", "warning");
			return;
		}

		const sourceStatuses = await getDivisionStatusForSession.run({ sessionId: sourceSessionId });
		const sourceComplete = sourceStatuses.length === 5 && sourceStatuses.every((s) => s.state === 'SUBMITTED');
		if (!sourceComplete) {
			showAlert("Artikel sumber belum SUBMITTED di semua divisi. Copy dibatalkan.", "error");
			return;
		}

		const succeeded = [];
		const blocked = [];
		const errors = [];

		for (const newSessionId of targetSessionIds) {
			try {
				const statuses = await getDivisionStatusForSession.run({ sessionId: newSessionId });
				const alreadySubmitted = statuses.some((s) => s.state === 'SUBMITTED');
				if (alreadySubmitted) {
					blocked.push(newSessionId);
					continue;
				}

				await copyPartProcessOverwrite.run({ oldSessionId: sourceSessionId, newSessionId });

				await copyWIPInputDelete.run({ newSessionId });
				await copyWIPDelete.run({ newSessionId });
				await copyWIPInsert.run({ oldSessionId: sourceSessionId, newSessionId });
				await carryOverWIPInputIngest.run({ oldSessionId: sourceSessionId, newSessionId });

				await copyCOSUnlinkPackages.run({ newSessionId });
				await copyCOSPackageDelete.run({ newSessionId });

				const cosPkgMapping = await carryOverCOSPkgIngest.run({ oldSessionId: sourceSessionId, newSessionId });
				if (cosPkgMapping && cosPkgMapping.length > 0) {
					await Promise.all(cosPkgMapping.map((m) =>
																							carryOverCOSPkgAssignIngest.run({
						oldSessionId: sourceSessionId,
						newSessionId,
						oldPackageId: m.old_package_id,
						newPackageId: m.new_package_id
					})
																						 ));
				}

				const bfrPkgMapping = await carryOverBfrPkgIngest.run({ oldSessionId: sourceSessionId, newSessionId });
				if (bfrPkgMapping && bfrPkgMapping.length > 0) {
					await Promise.all(bfrPkgMapping.map((m) =>
																							carryOverBfrPkgAssignIngest.run({
						oldSessionId: sourceSessionId,
						newSessionId,
						oldPackageId: m.old_package_id,
						newPackageId: m.new_package_id
					})
																						 ));
				}

				await copyBtmWIPInputDelete.run({ newSessionId });
				await copyBtmWIPDelete.run({ newSessionId });
				await copyBtmWIPInsert.run({ oldSessionId: sourceSessionId, newSessionId });
				await carryOverBtmWIPInputIngest.run({ oldSessionId: sourceSessionId, newSessionId });
				await copySocklinerFlagsIngest.run({ oldSessionId: sourceSessionId, newSessionId });

				await setDivisionsInWorkFromCopy.run({ oldSessionId: sourceSessionId, newSessionId });

				succeeded.push(newSessionId);
			} catch (e) {
				errors.push(newSessionId + ': ' + e.message);
			}
		}

		await getAllActiveSessions.run();

		if (sel_specArticle.selectedOptionValue) {
			await this.onArticleSelect();
		}

		let msg = succeeded.length + ' artikel berhasil di-copy proses (status: SUBMITTED otomatis).';
		if (blocked.length > 0) {
			msg += ' ' + blocked.length + ' artikel dilewati (sudah ada divisi SUBMITTED — set REWORK dulu kalau tetap mau diganti).';
		}
		if (errors.length > 0) {
			msg += ' GAGAL: ' + errors.join('; ');
		}

		showAlert(msg, errors.length > 0 ? 'error' : (blocked.length > 0 ? 'warning' : 'success'));

		return { succeeded, blocked, errors };
	},

	async loadCopyPreview() {
		const sourceSessionId = sel_copySource.selectedOptionValue;
		const targetSessionIds = msel_copyTargets.selectedOptionValues;

		if (!sourceSessionId || !targetSessionIds || targetSessionIds.length === 0) {
			showAlert("Pilih artikel sumber dan minimal 1 artikel target", "warning");
			return;
		}

		const sourceStatuses = await getDivisionStatusForSession.run({ sessionId: sourceSessionId });
		const sourceComplete = sourceStatuses.length === 5 && sourceStatuses.every((s) => s.state === 'SUBMITTED');
		if (!sourceComplete) {
			showAlert("Artikel sumber belum SUBMITTED di semua divisi. Selesaikan dulu sebelum bisa dijadikan sumber copy.", "warning");
			return;
		}

		const rows = [];
		for (const targetId of targetSessionIds) {
			const preview = await getCopyPreview.run({ oldSessionId: sourceSessionId, newSessionId: targetId });
			const statuses = await getDivisionStatusForSession.run({ sessionId: targetId });
			const alreadySubmitted = statuses.some((s) => s.state === 'SUBMITTED');
			const info = (getAllActiveSessions.data || []).find((s) => s.session_id === targetId);

			rows.push({
				session_id: targetId,
				article_id: info ? info.article_id : targetId,
				will_overwrite: preview[0].will_overwrite,
				will_fill_new: preview[0].will_fill_new,
				not_relevant: preview[0].not_relevant,
				already_submitted: alreadySubmitted
			});
		}

		storeValue('copyPreview', { sourceSessionId, rows });
		showModal('modal_copyProcess');
	},

	async onConfirmCopyProcess() {
		const pending = appsmith.store.copyPreview;
		if (!pending) return;

		const validTargets = pending.rows
		.filter((r) => !r.already_submitted)
		.map((r) => r.session_id);

		if (validTargets.length === 0) {
			showAlert("Semua target sudah SUBMITTED, tidak ada yang bisa di-copy. Minta Specsheet set REWORK dulu.", "warning");
			return;
		}

		closeModal('modal_copyProcess');
		await this.copyProcessToArticles(pending.sourceSessionId, validTargets);
		storeValue('copyPreview', null);
	},

}