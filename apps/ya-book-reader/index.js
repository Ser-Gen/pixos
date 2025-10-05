import {
	html,
	PolymerElement
} from "./resources/polymer/v3_0/polymer/polymer_bundled.min.js";
import {
	loadTimeData
} from "./resources/js/load_time_data.m.js";
import "./resources/js/zip/zip.js";
import "./resources/js/zip/inflate.js";
import "./resources/js/zip/mime_types.js";
import "./resources/js/reader_core/reader_core.js";
// Copyright 2020 Yandex LLC. All rights reserved.
const LoadTimeData = loadTimeData.constructor;
class ReaderLoadTimeData extends LoadTimeData {
	constructor() {
		super();
		this.promise_ = new Promise((e => {
			// return yandex.reader.getStrings((t => e(t)))
			return 'kek'
		})).then((e => {
			return this.data = e;
		}))
	}
	whenReady() {
		return this.promise_
	}
}
const readerLoadTimeData = new ReaderLoadTimeData;
// Copyright 2017 Yandex LLC. All rights reserved.
var BookFormat;
(function(e) {
	e["EPUB"] = "Epub";
	e["FB2"] = "Fb2";
	e["FB2ZIP"] = "Fb2Zip"
})(BookFormat || (BookFormat = {}));
class BookFormatHandler {
	static getBookFormat(e) {
		if (!e || e.length <= 0) {
			return null
		}
		switch (e.toLowerCase()) {
			case "application/epub+zip":
				return BookFormat.EPUB;
			case "application/x-zip-compressed-fb2":
				return BookFormat.FB2ZIP;
			case "application/x-fictionbook+xml":
				return BookFormat.FB2;
			default:
				return null
		}
	}
}
// Copyright 2017 Yandex LLC. All rights reserved.
class BookmarksHandler {
	constructor(e, t, o) {
		this.core_ = e;
		this.storage_ = t;
		this.bookmarks_ = o
	}
	getBookmarks() {
		return Promise.resolve(this.bookmarks_)
	}
	async addBookmarkOnCurrentPosition() {
		let [e, t] = await Promise.all([this.core_.getCurrentCfi(), this.core_.getCurrentTextFragment()]);
		if (t.length < 5) {
			t = readerLoadTimeData.getString("bookmarkDefault")
		} else if (t.length > 255) {
			t = t.substr(0, 255)
		}
		this.bookmarks_.push({
			cfi: e,
			title: t
		});
		await this.storage_.setBookmarks(this.bookmarks_)
	}
	async removeBookmarksOnCurrentPosition() {
		const e = await this.getVisibleBookmarks_();
		e.forEach((e => {
			const t = this.bookmarks_.indexOf(e);
			this.bookmarks_.splice(t, 1)
		}));
		await this.storage_.setBookmarks(this.bookmarks_)
	}
	async getVisibleBookmarks_() {
		if (!this.bookmarks_.length) {
			return []
		}
		const e = this.bookmarks_.map((e => this.core_.isCfiOnCurrentScreen(e.cfi)));
		const t = await Promise.all(e);
		return this.bookmarks_.filter(((e, o) => t[o]))
	}
	async hasVisibleBookmarks() {
		return (await this.getVisibleBookmarks_()).length > 0
	}
	static async create(e, t) {
		return new BookmarksHandler(e, t, await t.getBookmarks() || [])
	}
}
// Copyright 2016 Yandex LLC. All rights reserved.
class ScriptingApi {
	constructor() {
		this.handleMessageBound_ = this.handleMessage_.bind(this);
		window.addEventListener("message", this.handleMessageBound_)
	}
	handleMessage_(e) {
		this.parentWindow_ = e.source;
		this.parentWindowOrigin_ = e.origin;
		this.notifyIfAlreadyLoaded_()
	}
	notifyIfAlreadyLoaded_() {
		if (this.loaded_ && this.parentWindow_) {
			this.parentWindow_.postMessage({
				type: "loaded"
			}, this.parentWindowOrigin_)
		}
	}
	setLoaded() {
		this.loaded_ = true;
		this.notifyIfAlreadyLoaded_()
	}
	close() {
		window.removeEventListener("message", this.handleMessageBound_)
	}
}
// Copyright 2016 Yandex LLC. All rights reserved.
const STATISTICS_CLIENT_ID = "bkrdr";
class StatisticHandler {
	constructor(e, t) {
		this.format_ = e;
		this.histogramNamespace_ = this.format_ ? `BookReader.${this.format_}` : "BookReader";
		this.pageLoadTime_ = t;
		this.startupDataLoadedTime_ = performance.now();
		this.recordTimeHistogram_("UiLoading", this.pageLoadTime_);
		window.addEventListener("resize", (() => this.handleWindowResize_()))
	}
	readerInitiated() {
		this.readerInitiatedTime_ = performance.now();
		this.recordTimeHistogram_("ReaderInit", this.startupDataLoadedTime_);
		this.sendStatistics_("a_ext", this.format_)
	}
	readerStarted() {
		this.readerStartedTime_ = performance.now();
		this.recordTimeHistogram_("ReaderStart", this.readerInitiatedTime_);
		this.recordTimeHistogram_("FullStartup", this.pageLoadTime_)
	}
	leftArrowClicked() {
		this.pageChangeBeginTime_ = performance.now()
	}
	rightArrowClicked() {
		this.pageChangeBeginTime_ = performance.now()
	}
	tocItemClicked() {
		this.pageChangeBeginTime_ = performance.now()
	}
	bookmarkClicked() {
		this.pageChangeBeginTime_ = performance.now()
	}
	bookmarkAddClicked() {
		this.sendStatistics_("bk_fav")
	}
	bookmarkRemoveClicked() {
		this.sendStatistics_("bk_unf")
	}
	menuPlusClicked() {
		this.sendStatistics_("bk_plus")
	}
	menuMinusClicked() {
		this.sendStatistics_("bk_minus")
	}
	menuOpenClicked() {
		this.sendStatistics_("bk_show")
	}
	menuCloseClicked() {
		this.sendStatistics_("bk_hide")
	}
	menuNavigationClicked() {
		this.sendStatistics_("bk_navi")
	}
	readerDocumentChanged() {
		this.pageChangeBeginTime_ = performance.now();
		this.readerDocumentChangedTime_ = performance.now()
	}
	readerPageChanged() {
		if (this.pageChangeBeginTime_) {
			const e = this.pageChangeBeginTime_ <= this.readerDocumentChangedTime_;
			const t = e ? "PageAndChapterChange" : "PageChange";
			this.recordTimeHistogram_(t, this.pageChangeBeginTime_);
			this.pageChangeBeginTime_ = null
		}
	}
	readerProgressChanged(e) {
		if (this.format_ !== BookFormat.EPUB || e.unknown) {
			return
		}
		if (!this.readerPagesCountedFirstTime_) {
			this.readerPagesCountedFirstTime_ = performance.now();
			this.recordTimeHistogram_("PagesCountFirst", this.readerStartedTime_)
		}
		if (this.progressChangedDueToResize_) {
			this.progressChangedDueToResize_ = false;
			this.recordTimeHistogram_("PagesCountResize", this.readerStartedTime_)
		}
	}
	handleWindowResize_() {
		if (this.readerStartedTime_) {
			this.progressChangedDueToResize_ = true
		}
	}
	recordTimeHistogram_(e, t, o) {
		const a = Math.round((o ?? performance.now()) - t);
		const r = `${this.histogramNamespace_}.${e}`;
		// chrome.metricsPrivate.recordTime(r, a)
	}
	sendStatistics_(e, t = 1) {
		// yandex.statistics.send(STATISTICS_CLIENT_ID, {
		// 	[e]: t
		// })
	}
}
// Copyright 2017 Yandex LLC. All rights reserved.
var StorageField;
(function(e) {
	e["BOOKMARKS"] = "bookmarks";
	e["FONT_SIZE"] = "fontSize";
	e["IS_MIGRATED"] = "isMigrated";
	e["POSITION"] = "position";
	e["RENDER_MODE"] = "renderMode"
})(StorageField || (StorageField = {}));
class StorageHandler {
	constructor(e) {
		this.saveQueue_ = Promise.resolve();
		this.bid_ = e
	}
	get bid() {
		return this.bid_
	}
	getFontSize() {
		return this.getParam_(StorageField.FONT_SIZE)
	}
	setFontSize(e) {
		return this.setParam_(StorageField.FONT_SIZE, e)
	}
	getPosition() {
		return this.getParam_(StorageField.POSITION)
	}
	setPosition(e) {
		return this.setParam_(StorageField.POSITION, e)
	}
	getRenderMode() {
		return this.getParam_(StorageField.RENDER_MODE)
	}
	setRenderMode(e) {
		return this.setParam_(StorageField.RENDER_MODE, e)
	}
	getBookmarks() {
		return this.getParam_(StorageField.BOOKMARKS)
	}
	setBookmarks(e) {
		return this.setParam_(StorageField.BOOKMARKS, e)
	}
	getIsMigrated() {
		return this.getParam_(StorageField.IS_MIGRATED)
	}
	setIsMigrated(e) {
		return this.setParam_(StorageField.IS_MIGRATED, e)
	}
	getFromStorageAsync_(e) {
		return new Promise((t => {
			chrome.storage.local.get(e, t)
		}))
	}
	setToStorageAsync_(e) {
		return new Promise((t => {
			chrome.storage.local.set(e, t)
		}))
	}
	async getParam_(e) {
		const t = this.bid_ + ".settings";
		const {
			[t]: o = {}
		} = await this.getFromStorageAsync_(t);
		return o[e] || null
	}
	setParam_(e, t) {
		const o = this.bid_ + ".settings";
		return this.saveQueue_ = this.saveQueue_.then((() => this.getFromStorageAsync_(o))).then((({
			[o]: a = {}
		}) => {
			a[e] = t;
			return this.setToStorageAsync_({
				[o]: a
			})
		}))
	}
	static calculateBid_(e, t) {
		const o = e.getBookTitle();
		const a = e.getCreator();
		const r = StorageHandler.createId_(o + a);
		const i = Array.from(r).map((e => e.charCodeAt(0).toString())).join("");
		return `v2.${t}${i}`.slice(0, 32)
	}
	static calculateLegacyBid_(e, t) {
		const o = e.getBookTitle();
		const a = e.getCreator();
		const r = StorageHandler.createId_(o + a);
		const i = Array.from(r).map((e => r.charCodeAt(e).toString())).join("");
		return (t + "" + i).slice(0, 32)
	}
	static createId_(e) {
		return e.replace(/[^\w\u0430-\u044f\u0410-\u042f\u0451\u0401]/g, "")
	}
	async migrateLegacyParamsIfAny_(e, t) {
		if (await this.getIsMigrated()) {
			return
		}
		const o = e + ".settings";
		const {
			[o]: a
		} = await this.getFromStorageAsync_(o);
		if (!a) {
			return
		}
		const r = a["v2.position"];
		if (r) {
			const e = StorageHandler.fixLegacyCfi_(r, t);
			if (e) {
				await this.setPosition(e)
			}
		}
		const i = a.bookmarks;
		if (i) {
			const e = i.map((e => ({
				cfi: StorageHandler.fixLegacyCfi_(e["v2.cfi"], t),
				title: e.title
			}))).filter((e => Boolean(e.cfi)));
			await this.setBookmarks(e)
		}
		await this.setIsMigrated(true)
	}
	static fixLegacyCfi_(e, t) {
		try {
			if (t === BookFormat.FB2 || t === BookFormat.FB2ZIP) {
				return e.split("!").pop()
			}
			if (t === BookFormat.EPUB) {
				const t = e.split("/");
				t[1] = (parseInt(t[1], 10) * 2).toString();
				return t.join("/")
			}
			return null
		} catch (e) {
			return null
		}
	}
	static async create(e, t) {
		const o = await e.getPackage();
		const a = await o.getMetadata();
		const r = o.getStreamSize();
		const i = StorageHandler.calculateBid_(a, r);
		const n = new StorageHandler(i);
		const s = StorageHandler.calculateLegacyBid_(a, r);
		await n.migrateLegacyParamsIfAny_(s, t);
		return n
	}
}
// Copyright 2022 Yandex LLC. All rights reserved.
const zip = globalThis.zip;
zip.workerScripts = {
	inflater: ["resources/js/zip/z_worker.js", "resources/js/zip/inflate.js"]
};
// Copyright 2022 Yandex LLC. All rights reserved.
const ReaderCoreInternal = globalThis.ReaderCore;
// Copyright 2021 Yandex LLC. All rights reserved.
const readerBookmarksTemplate = html`
<style>
:host {
	font-family: Georgia, "Times New Roman", serif;
}

.no-bookmarks-stub {
	position: absolute;
	top: calc(139px + (100vh - 139px)/2 - 28px) /* Center of empty screen part */;

	width: 500px;
	height: 100%;
	margin-left: -250px;

	text-align: center;

	color: rgba(255,255,255, 0.6);

	font-size: 18px;
	font-style: italic;
	line-height: 28px;
}

.bookmarks-item {
	display: -webkit-box;
	overflow: hidden;

	min-height: 25px;
	max-height: 70px;
	margin-bottom: 10px;
	padding-left: 25px;

	cursor: pointer;

	color: rgba(255,255,255, 0.85);
	background: url("elements/reader_bookmarks/images/bookmark_item.png") no-repeat;

	font-size: 16px;
	font-weight: bold;

	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	-webkit-mask-image: -webkit-gradient(linear,
																			 left top,
																			 left bottom,
																			 from(black),
																			 color-stop(80%, black),
																			 to(transparent));
}

.bookmarks-item:hover {
	color: rgba(255,255,255, 1);
}
</style>

<dom-if if="[[bookmarks.length]]" restamp>
	<template>
		<div class="bookmarks" on-click="handleBookmarksClick_">
			<dom-repeat items="[[bookmarks]]" as="bookmark">
				<template>
					<div class="bookmarks-item" cfi$="[[bookmark.cfi]]">
						[[bookmark.title]]
					</div>
				</template>
			</dom-repeat>
		</div>
	</template>
</dom-if>

<dom-if if="[[!bookmarks.length]]" restamp>
	<template>
		<div class="no-bookmarks-stub">Здесь появятся закладки, которые вы добавите. Пока их нет.</div>
	</template>
</dom-if>
`;
// Copyright 2016 Yandex LLC. All rights reserved.
class ReaderBookmarks extends PolymerElement {
	handleBookmarksClick_(e) {
		if (!e.target) {
			return
		}
		const t = e.target;
		if (!t.classList.contains("bookmarks-item")) {
			return
		}
		const o = t.getAttribute("cfi");
		this.dispatchEvent(new CustomEvent("navigate-bookmark", {
			detail: {
				cfi: o
			}
		}))
	}
}
ReaderBookmarks.is = "reader-bookmarks";
ReaderBookmarks.template = readerBookmarksTemplate;
ReaderBookmarks.properties = {
	bookmarks: {
		type: Array,
		value: () => []
	}
};
customElements.define(ReaderBookmarks.is, ReaderBookmarks);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerCoverTemplate = html`
<style>
#cover {
	background: url("elements/reader_cover/images/book_cover.png") no-repeat 0 0;
	background-size: cover;

	display: flex;
	flex-direction: column;
	align-items: stretch;
	justify-content: space-between;

	width: calc(100vh * 2 / 3);
	min-height: 200px;
	padding: calc(100vh / 8) 0 50px;

	text-align: center;
	font-family: sans-serif;
}

#title {
	font-size: 24px;

	padding: 0 40px;
}

#creator {
	font-size: 14px;
	font-style: italic;

	padding: 0 40px;
	margin: 20px 0 0;
}

#year {
	color: rgba(0, 0, 0, 0.6);
	font-size: 12px;
}
</style>

<div id="cover">
	<div id="about">
		<div id="title">[[title_]]</div>
		<div id="creator">[[creator_]]</div>
	</div>
	<div id="year">[[year_]]</div>
</div>
`;
// Copyright 2017 Yandex LLC. All rights reserved.
class ReaderCover extends PolymerElement {
	computeCreator_(e) {
		return e?.getCreator() ?? ""
	}
	computeTitle_(e) {
		return e?.getBookTitle() ?? ""
	}
	computeYear_(e) {
		return e?.getYear() ?? ""
	}
}
ReaderCover.is = "reader-cover";
ReaderCover.template = readerCoverTemplate;
ReaderCover.properties = {
	model: {
		type: Object,
		value: null
	},
	creator_: {
		type: String,
		computed: "computeCreator_(model)"
	},
	title_: {
		type: String,
		computed: "computeTitle_(model)"
	},
	year_: {
		type: String,
		computed: "computeYear_(model)"
	}
};
customElements.define(ReaderCover.is, ReaderCover);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerMenuTemplate = html`
<style>
:host {
	overflow: hidden;

	width: 42px;

	cursor: pointer;
	-webkit-user-select: none;
	user-select: none;
	transition-timing-function: cubic-bezier(.75,0,.25,1);
	transition-duration: 0.25s;
	transition-property: height, background-color, box-shadow;

	border-radius: 21px;
}

:host([open]) {
	height: auto;

	background-color: rgba(255, 255, 255, 0.90);
	box-shadow: 0 1px 4px 0 rgba(0, 0, 0, 0.30);
}

:host(:not([open])) {
	height: 42px;

	background-color: rgba(127, 127, 127, 0.50);
}

:host(:not([open])) .reader-menu__controls_state_open,
:host([open]) .reader-menu__controls_state_closed {
	display: none;
}

.reader-menu__control {
	width: 42px;
	height: 40px;

	background: no-repeat center;
}

.reader-menu__control:first-child,
.reader-menu__control:last-child {
	height: 42px;
}

.reader-menu__control_action_open {
	background-image: url("elements/reader_menu/images/menu_action_open.png");
}

.reader-menu__control_action_open:hover {
	background-color: rgba(127, 127, 127, 0.75);
}

.reader-menu__control_action_close {
	background-image: url("elements/reader_menu/images/menu_action_close.png");
	background-position-y: 18px;
}

.reader-menu__control_action_close:hover {
	background-image: url("elements/reader_menu/images/menu_action_close_hover.png");
}

.reader-menu__control_action_minus {
	background-image: url("elements/reader_menu/images/menu_action_minus.png");
}

.reader-menu__control_action_minus:hover {
	background-image: url("elements/reader_menu/images/menu_action_minus_hover.png");
}

.reader-menu__control_action_plus {
	background-image: url("elements/reader_menu/images/menu_action_plus.png");
}

.reader-menu__control_action_plus:hover {
	background-image: url("elements/reader_menu/images/menu_action_plus_hover.png");
}

.reader-menu__control_action_navigation {
	background-image: url("elements/reader_menu/images/menu_action_navigation.png");
	background-position-y: 10px;
}

.reader-menu__control_action_navigation:hover {
	background-image: url("elements/reader_menu/images/menu_action_navigation_hover.png");
}

.reader-menu__control_action_mode_scroll {
	background-image: url("elements/reader_menu/images/menu_action_mode_scroll.png");
	background-position-y: 10px;
}

.reader-menu__control_action_mode_scroll:hover {
	background-image: url("elements/reader_menu/images/menu_action_mode_scroll_hover.png");
}

:host([mode="scroll"]) .reader-menu__control_action_mode_scroll {
	display: none;
}

.reader-menu__control_action_mode_page {
	background-image: url("elements/reader_menu/images/menu_action_mode_page.png");
	background-position-y: 10px;
}

.reader-menu__control_action_mode_page:hover {
	background-image: url("elements/reader_menu/images/menu_action_mode_page_hover.png");
}

:host([mode="page"]) .reader-menu__control_action_mode_page {
	display: none;
}

.reader-menu__control-delimiter {
	height: 1px;

	background: url("elements/reader_menu/images/menu_delimiter.png") no-repeat center;
}
</style>

<div class="reader-menu__controls_state_closed">
	<div class="reader-menu__control reader-menu__control_action_open"
			 title="Показать меню"
			 on-click="handleOpenButtonClick_">
	</div>
</div>
<div class="reader-menu__controls_state_open">
	<div class="reader-menu__control reader-menu__control_action_close"
			 title="Скрыть меню"
			 on-click="handleCloseButtonClick_">
	</div>
	<div class="reader-menu__control-delimiter"></div>
	<div class="reader-menu__control reader-menu__control_action_mode_scroll"
			 title="В одну колонку"
			 on-click="handleScrollModeButtonClick_">
	</div>
	<div class="reader-menu__control reader-menu__control_action_mode_page"
			 title="В две колонки"
			 on-click="handlePageModeButtonClick_">
	</div>
	<div class="reader-menu__control-delimiter"></div>
	<div class="reader-menu__control reader-menu__control_action_minus"
			 title="Уменьшить текст"
			 on-click="handleMinusButtonClick_">
	</div>
	<div class="reader-menu__control-delimiter"></div>
	<div class="reader-menu__control reader-menu__control_action_plus"
			 title="Увеличить текст"
			 on-click="handlePlusButtonClick_">
	</div>
	<div class="reader-menu__control-delimiter"></div>
	<div class="reader-menu__control reader-menu__control_action_navigation"
			 title="Оглавление и закладки"
			 on-click="handleNavigationButtonClick_">
	</div>
</div>
`;
// Copyright 2016 Yandex LLC. All rights reserved.
class ReaderMenu extends PolymerElement {
	handleCloseButtonClick_() {
		this.open = false
	}
	handleMinusButtonClick_() {
		this.dispatchEvent(new Event("action-minus"))
	}
	handleNavigationButtonClick_() {
		this.dispatchEvent(new Event("action-navigation"))
	}
	handleOpenButtonClick_() {
		this.open = true
	}
	handlePageModeButtonClick_() {
		this.dispatchEvent(new CustomEvent("action-mode", {
			detail: "page"
		}))
	}
	handlePlusButtonClick_() {
		this.dispatchEvent(new Event("action-plus"))
	}
	handleScrollModeButtonClick_() {
		this.dispatchEvent(new CustomEvent("action-mode", {
			detail: "scroll"
		}))
	}
}
ReaderMenu.is = "reader-menu";
ReaderMenu.template = readerMenuTemplate;
ReaderMenu.properties = {
	open: {
		type: Boolean,
		notify: true,
		reflectToAttribute: true
	},
	mode: {
		type: String,
		reflectToAttribute: true
	}
};
customElements.define(ReaderMenu.is, ReaderMenu);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerNavigationTemplate = html`
<style>
:host {
	overflow: auto;

	color: rgba(255, 255, 255, 0.85);
	background-image: radial-gradient(50% 100%, #4C4545 50%, #332B2B 100%);
}

.book-info {
	padding-top: 36px;

	font-family: Georgia, "Times New Roman", serif;
}

.close-button {
	position: fixed;
	top: 20px;
	left: 20px;

	width: 20px;
	height: 21px;

	background-image: url("elements/reader_navigation/images/close_button.png");
}

.scrollable-content {
	display: flex;
	flex-direction: column;

	width: calc(100vw - 20px);
	min-height: 100%;
}

.close-button:hover {
	background-image: url("elements/reader_navigation/images/close_button_hover.png");
}

.book-title {
	min-height: 25px;

	text-align: center;

	font-size: 24px;
}

.book-author {
	padding-top: 6px;

	text-align: center;

	font-size: 14px;
	font-style: italic;
}

.content-trigger {
	display: flex;
	flex-direction: row;

	margin: 26px auto 24px;

	justify-content: center;
}

.content-trigger__button {
	width: 122px;
	height: 28px;

	cursor: default;
	text-align: center;

	color: rgb(255,255,255);
	background: rgba(255,255,255,0.15);

	font-size: 13px;
	line-height: 28px;
}

.content-trigger__button_active {
	color: rgb(0,0,0);
	background: rgba(255,255,255,0.80);
	-webkit-box-shadow: 0 2px 4px 0 rgba(0,0,0,0.50);
					box-shadow: 0 2px 4px 0 rgba(0,0,0,0.50);
}

.content-tabs {
	max-width: 500px;
	margin: 0 auto;
}

.content-tabs__tab {
	display: flex;
	flex-direction: column;

	height: 100%;
}

.content-tabs__tab:not(.content-tabs__tab_active) {
	display: none;
}
</style>

<div class="close-button"
		 title="Закрыть"
		 on-click="hide_">
</div>
<div class="scrollable-content">
	<div class="book-info">
		<div class="book-title">[[title_]]</div>
		<div class="book-author">[[author_]]</div>
	</div>
	<div class="content-trigger">
		<div id="toc-button"
				 class="content-trigger__button content-trigger__button-toc content-trigger__button_active"
				 on-click="handleToCButtonClick_">
			Оглавление
		</div>
		<div id="bookmarks-button"
				 class="content-trigger__button content-trigger__button-bookmarks"
				 on-click="handleBookmarksButtonClick_">
			Закладки
		</div>
	</div>

	<div class="content-tabs">
		<div id="toc-tab"
				 class="content-tabs__tab content-tabs__tab-toc content-tabs__tab_active">
			<slot name="toc-tree"></slot>
		</div>
		<div id="bookmarks-tab"
				 class="content-tabs__tab content-tabs__tab-bookmarks">
			<slot name="bookmarks"></slot>
		</div>
	</div>
</div>
`;
// Copyright 2016 Yandex LLC. All rights reserved.
class ReaderNavigation extends PolymerElement {
	constructor() {
		super(...arguments);
		this.hideBound_ = this.hide_.bind(this)
	}
	connectedCallback() {
		super.connectedCallback();
		this.querySelector("reader-bookmarks")?.addEventListener("navigate-bookmark", this.hideBound_);
		this.querySelector("reader-toc-tree")?.addEventListener("navigate-toc-item", this.hideBound_)
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.querySelector("reader-bookmarks")?.removeEventListener("navigate-bookmark", this.hideBound_);
		this.querySelector("reader-toc-tree")?.removeEventListener("navigate-toc-item", this.hideBound_)
	}
	computeAuthor_(e) {
		return e?.getCreator() ?? ""
	}
	computeTitle_(e) {
		return e?.getBookTitle() ?? ""
	}
	hide_() {
		this.hidden = true
	}
	handleBookmarksButtonClick_() {
		this.$["toc-button"].classList.remove("content-trigger__button_active");
		this.$["bookmarks-button"].classList.add("content-trigger__button_active");
		this.$["toc-tab"].classList.remove("content-tabs__tab_active");
		this.$["bookmarks-tab"].classList.add("content-tabs__tab_active")
	}
	handleToCButtonClick_() {
		this.$["toc-button"].classList.add("content-trigger__button_active");
		this.$["bookmarks-button"].classList.remove("content-trigger__button_active");
		this.$["toc-tab"].classList.add("content-tabs__tab_active");
		this.$["bookmarks-tab"].classList.remove("content-tabs__tab_active")
	}
}
ReaderNavigation.is = "reader-navigation";
ReaderNavigation.template = readerNavigationTemplate;
ReaderNavigation.properties = {
	metadata: {
		type: Object,
		value: null
	},
	author_: {
		type: String,
		computed: "computeAuthor_(metadata)"
	},
	title_: {
		type: String,
		computed: "computeTitle_(metadata)"
	}
};
customElements.define(ReaderNavigation.is, ReaderNavigation);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerThrobberTemplate = html`
<style>
@-webkit-keyframes loading {
	from {
		transform:rotate(0deg);
	}
	to {
		transform:rotate(360deg);
	}
}

.throbber {
	display: block;
	position: relative;

	opacity: 1;
	transition: opacity 0.5s ease;

	height: 32px;
	width: 32px;
}

:host([small]) .throbber{
	height: 16px;
	width: 16px;
}

.throbber__spinner {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	bottom: 0;

	opacity: .7;
	overflow: hidden;
	background: #ccc;

	-webkit-mask-image: url("resources/yandex/images/loader.svg");
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-size: 32px 32px;

	animation-name: loading;
	animation-duration: 1s;
	animation-iteration-count: infinite;
	animation-timing-function: linear;
}

:host([small]) .throbber__spinner {
	-webkit-mask-size: 16px 16px;
}
</style>

<div class="throbber">
	<div class="throbber__spinner"></div>
</div>
`;
// Copyright 2016 Yandex LLC. All rights reserved.
class ReaderThrobber extends PolymerElement {}
ReaderThrobber.is = "reader-throbber";
ReaderThrobber.template = readerThrobberTemplate;
customElements.define(ReaderThrobber.is, ReaderThrobber);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerProgressTemplate = html`
<style>
#loader {
	width: 16px;
	margin: 0 auto;
}
</style>

<div id="loader" hidden="[[!progress.unknown]]">
	<reader-throbber small></reader-throbber>
</div>
<div id="progress" hidden="[[progress.unknown]]">
	[[progressLabel_]]
</div>
`;
// Copyright 2016 Yandex LLC. All rights reserved.
class ReaderProgress extends PolymerElement {
	updateProgressLabel_(e) {
		if (!e) {
			this.progressLabel_ = ""
		} else {
			this.progressLabel_ = readerLoadTimeData.getStringF("pageNumber", e.currentPage, e.totalPages)
		}
	}
}
ReaderProgress.is = "reader-progress";
ReaderProgress.template = readerProgressTemplate;
ReaderProgress.properties = {
	progress: {
		type: Object,
		value: null
	},
	progressLabel_: {
		type: String
	}
};
ReaderProgress.observers = ["updateProgressLabel_(progress)"];
customElements.define(ReaderProgress.is, ReaderProgress);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerToCTreeNodeTemplate = html`
<style>
:host {
	/* Only title should be clickable. */
	pointer-events: none;
}

.toc-tree-node {
	padding-top: 8px;

	font-family: Georgia, 'Times New Roman', serif;
	font-size: 16px;
	line-height: 20px;
}

.toc-tree-node__title {
	display: inline-block;

	cursor: pointer;

	color: rgba(255, 255, 255, 0.85);

	pointer-events: auto;
}

.toc-tree-node__title:hover {
	color: rgba(255, 255, 255, 1);
}

.toc-tree-node__subtree {
	padding-left: 1.6em;
}
</style>

<div class="toc-tree-node">
	<div class="toc-tree-node__title">
		[[title_]]
	</div>
	<div class="toc-tree-node__subtree">
		<dom-repeat items="[[childNodes_]]" as="childNode">
			<template>
				<reader-toc-tree-node node="[[childNode]]"></reader-toc-tree-node>
			</template>
		</dom-repeat>
	</div>
</div>
`;
// Copyright 2021 Yandex LLC. All rights reserved.
class ReaderToCTreeNode extends PolymerElement {
	computeChildNodes_(e) {
		return e?.getChildren() ?? []
	}
	computeHref_(e) {
		return e?.getHref() ?? ""
	}
	computeTitle_(e) {
		return e?.getTitle() ?? ""
	}
}
ReaderToCTreeNode.is = "reader-toc-tree-node";
ReaderToCTreeNode.template = readerToCTreeNodeTemplate;
ReaderToCTreeNode.properties = {
	href: {
		type: String,
		computed: "computeHref_(node)"
	},
	node: {
		type: Object
	},
	childNodes_: {
		type: Array,
		computed: "computeChildNodes_(node)"
	},
	title_: {
		type: String,
		computed: "computeTitle_(node)"
	}
};
customElements.define(ReaderToCTreeNode.is, ReaderToCTreeNode);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerToCTreeTemplate = html`
<style>
.toc-tree {
}
</style>

<div class="toc-tree" on-click="handleToCTreeClick_">
	<dom-repeat items="[[nodes_]]" as="node">
		<template>
			<reader-toc-tree-node node="[[node]]"></reader-toc-tree-node>
		</template>
	</dom-repeat>
</div>
`;
// Copyright 2016 Yandex LLC. All rights reserved.
class ReaderToCTree extends PolymerElement {
	computeNodes_(e) {
		return e?.getChildren() ?? []
	}
	handleToCTreeClick_(e) {
		const t = e.composedPath();
		const o = t.find((e => e.tagName?.toLowerCase() === ReaderToCTreeNode.is));
		if (o) {
			this.dispatchEvent(new CustomEvent("navigate-toc-item", {
				detail: {
					href: o.href
				}
			}))
		}
	}
}
ReaderToCTree.is = "reader-toc-tree";
ReaderToCTree.template = readerToCTreeTemplate;
ReaderToCTree.properties = {
	tocTree: {
		type: Object
	},
	nodes_: {
		type: Array,
		computed: "computeNodes_(tocTree)"
	}
};
customElements.define(ReaderToCTree.is, ReaderToCTree);
// Copyright 2021 Yandex LLC. All rights reserved.
const readerPageTemplate = html`
<style>
:host {
	display: block;
}

:host([hidden]) {
	display: none;
}

.book-throbber {
	display: none;
}

.reader-menu {
	position: absolute;
	top: 20px;
	left: 20px;
}

.book-title,
.book-progress {
	position: absolute;
	left: 0;

	box-sizing: border-box;
	width: 100%;
	padding: 0 80px;

	text-align: center;

	color: rgba(0, 0, 0, 0.6);

	font-size: 12px;
}

.book-title {
	top: 20px;
}

.book-progress {
	bottom: 20px;
}

.bookmark-label {
	position: absolute;
	top: -1px;
	right: 30px;

	box-sizing: border-box;
	width: 22px;
	height: 32px;

	background: url("elements/reader_page/images/bookmark_icon.png");
}

.bookmark-label:hover {
	background: url("elements/reader_page/images/bookmark_icon_hover.png");
}

.bookmark-label_active,
.bookmark-label_active:hover {
	background: url("elements/reader_page/images/bookmark_icon_active.png");
}

.book-wrapper {
	box-sizing: border-box;
	width: 100%;
	height: 100%;
	padding: 50px 81px 80px 81px;
}

.book-container {
	width: 100%;
	height: 100%;

	position: relative;
}

.page-arrow {
	position: absolute;
	z-index: 2;
	top: 50%;

	width: 28px;
	height: 52px;
	margin-top: -26px;

	cursor: pointer;
}

.page-arrow_left {
	left: 27px;

	background: url("elements/reader_page/images/arrow_left.png");
}

.page-arrow_left:hover {
	background: url("elements/reader_page/images/arrow_left_hover.png");
}

.page-arrow_right {
	right: 27px;

	background: url("elements/reader_page/images/arrow_right.png");
}

.page-arrow_right:hover {
	background: url("elements/reader_page/images/arrow_right_hover.png");
}

:host-context([show-cover]) .page-arrow_left {
	display: none;
}

:host-context([last-page]) .page-arrow_right {
	display: none;
}

.reader-navigation {
	position: fixed;
	z-index: 5;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
}

/* Cover visible */
#reader-cover {
	position: absolute;
	z-index: 1;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;

	display: flex;
	flex-direction: row;

	box-sizing: border-box;
	padding-top: 50px;
	padding-bottom: 50px;

	background-color: var(--body-background-color);

	justify-content: center;
}

:host(:not([show-cover])) #reader-cover {
	display: none;
}

/* Loading */
:host([loading]) #book-throbber {
	position: absolute;
	z-index: 2;
	top: 50%;
	left: 50%;

	display: block;

	width: 32px;
	height: 32px;
	margin: -16px 0 0 -16px;
}
</style>

<!-- Main loading throbber. -->
<div id="book-throbber" class="book-throbber">
	<reader-throbber></reader-throbber>
</div>

<!-- Book container. -->
<div class="book-wrapper">
	<div id="book-container" class="book-container"></div>
</div>

<!-- Reader menu -->
<reader-menu id="reader-menu"
						 class="reader-menu"
						 open="{{menuOpen}}"
						 on-action-plus="handleMenuActionPlus_"
						 on-action-minus="handleMenuActionMinus_"
						 on-action-navigation="handleMenuActionNavigation_"
						 on-action-mode="handleMenuActionMode_"
						 hidden>
</reader-menu>

<!-- Book title. -->
<div id="book-title"
		 class="book-title"
		 hidden="[[!menuOpen]]">
</div>

<!-- Bookmark label. -->
<div id="bookmark-label"
		 class="bookmark-label"
		 title="Добавить в закладки"
		 on-click="handleBookmarkClick_">
</div>

<!-- Book navigation arrows. -->
<div id="left-arrow"
		 class="page-arrow page-arrow_left"
		 on-click="handleLeftArrowClick_">
</div>
<div id="right-arrow"
		 class="page-arrow page-arrow_right"
		 on-click="handleRightArrowClick_">
</div>

<!-- Book read progress. -->
<reader-progress id="book-progress"
								 class="book-progress"
								 hidden="[[!menuOpen]]">
</reader-progress>

<!-- Reader toc tree and bookmarks. -->
<reader-navigation id="reader-navigation" class="reader-navigation" hidden>
	<reader-toc-tree id="reader-toc-tree"
									 slot="toc-tree"
									 on-navigate-toc-item="handleTocTreeNavigateTocItem_">
	</reader-toc-tree>
	<reader-bookmarks id="reader-bookmarks"
										slot="bookmarks"
										on-navigate-bookmark="handleBookmarksNavigateBookmark_">
	</reader-bookmarks>
</reader-navigation>

<!-- Book cover. -->
<reader-cover id="reader-cover"></reader-cover>
`;
// Copyright 2017 Yandex LLC. All rights reserved.
class ReaderPage extends PolymerElement {
	constructor() {
		super();
		this.scriptingApi_ = new ScriptingApi;
		this.setAttribute("tabindex", "0")
	}
	async connectedCallback() {
		super.connectedCallback();
		var src = this.getAttribute('src');
		var type = this.getAttribute('type');
		var mime = 'application/epub+zip';

		console.log(type);

		if (
			type === 'epub'
			|| src.match(/.epub$/)
		) {
			mime = 'application/epub+zip';
		}
		else if (
			type === 'fb2.zip'
			|| src.match(/.fb2.zip$/)
		) {
			mime = 'application/x-zip-compressed-fb2';
		}
		else if (
			type === 'fb2'
			|| src.match(/.fb2$/)
		) {
			mime = 'application/x-fictionbook+xml';
		}
		
		const e = performance.now();
		const t = await new Promise((e => {
			// return chrome.mimeHandlerPrivate.getStreamInfo(e);
			return e({
				originalUrl: 'string',
				mimeType: mime,
				streamUrl: src,
				tabId: 0,
				responseHeaders: {
				},
				embedded: true,
			});
		}));
		this.format_ = BookFormatHandler.getBookFormat(t.mimeType);
		this.core_ = await ReaderPage.createCore_(t, this.$["book-container"]);
		await this.updateMeta_();
		this.showCover_();
		// this.storage_ = await StorageHandler.create(this.core_, this.format_);
		// this.bookmarks_ = await BookmarksHandler.create(this.core_, this.storage_);
		this.storage_ = {};
		this.bookmarks_ = {};
		this.statistic_ = new StatisticHandler(this.format_, e);
		this.statistic_.readerInitiated();
		this.core_.addEventListener("progressChanged", (e => this.handleReaderCoreProgressChanged_(e)));
		this.core_.addEventListener("pageChanged", (() => this.handleReaderCorePageChanged_()));
		this.core_.addEventListener("documentChanged", (() => this.handleReaderCoreDocumentChanged_()));
		this.core_.addEventListener("navigateExternal", (e => this.handleReaderCoreNavigateExternal_(e)));
		this.core_.addEventListener("bookKeydown", (e => this.handleBookKeydown_(e)));
		this.addEventListener("keydown", (e => this.handleBookKeydown_(e)));
		// const o = await this.storage_.getRenderMode();
		const o = null;
		if (o !== null) {
			await this.core_.setRenderMode(o)
		}
		this.$["reader-menu"].mode = this.core_.getRenderMode();
		// const a = await this.storage_.getFontSize();
		const a = null;
		if (a !== null) {
			await this.core_.updatePresentationOptions({
				fontSize: a
			})
		}
		// const r = await this.storage_.getPosition();
		const r = null;
		if (r) {
			try {
				await this.core_.navigateCfi(r)
			} catch (e) {
				await this.core_.navigateBookStart()
			}
		} else {
			await this.core_.navigateBookStart()
		}
		await Promise.all([this.updateArrowVisibility_(), this.updateBookmarkLabelActivity_()]);
		this.shadowRoot?.querySelector("#book-throbber")?.remove();
		this.$["reader-menu"].hidden = false;
		this.loading = false;
		this.statistic_.readerStarted();
		this.scriptingApi_.setLoaded();
		this.focus()
	}
	async handleBookmarkClick_() {
		const e = this.$["bookmark-label"].classList.contains("bookmark-label_active");
		if (e) {
			await this.bookmarks_.removeBookmarksOnCurrentPosition();
			this.deactivateBookmarkLabel_();
			this.statistic_.bookmarkRemoveClicked()
		} else {
			await this.bookmarks_.addBookmarkOnCurrentPosition();
			this.activateBookmarkLabel_();
			this.statistic_.bookmarkAddClicked()
		}
	}
	activateBookmarkLabel_() {
		this.$["bookmark-label"].classList.add("bookmark-label_active");
		this.$["bookmark-label"].title = readerLoadTimeData.getString("tooltipMessageBookmarkActive")
	}
	deactivateBookmarkLabel_() {
		this.$["bookmark-label"].classList.remove("bookmark-label_active");
		this.$["bookmark-label"].title = readerLoadTimeData.getString("tooltipMessageBookmarkInactive")
	}
	async updateBookmarkLabelActivity_() {
		const e = await this.bookmarks_.hasVisibleBookmarks();
		if (e) {
			this.activateBookmarkLabel_()
		} else {
			this.deactivateBookmarkLabel_()
		}
	}
	async updateArrowVisibility_() {
		const {
			prev: e,
			next: t
		} = await this.core_.canNavigatePrevOrNext();
		this.firstPage = !e;
		this.lastPage = !t
	}
	updateCover_(e) {
		this.$["reader-cover"].model = e
	}
	showCover_() {
		this.showCover = true
	}
	hideCover_() {
		this.showCover = false
	}
	async updateMeta_() {
		const e = await this.core_.getPackage();
		const t = await e.getMetadata();
		this.updateCover_(t);
		this.updateTitle_(t)
	}
	updateTitle_(e) {
		const t = e.getBookTitle();
		const o = e.getCreator();
		const a = t + (t && o ? " - " : "") + o;
		const r = document.querySelector("head title");
		r.textContent = a;
		this.$["book-title"].textContent = a
	}
	observeMenuOpenChanged_(e, t) {
		if (typeof t === "undefined") {
			return
		}
		if (e) {
			this.statistic_.menuOpenClicked()
		} else {
			this.statistic_.menuCloseClicked()
		}
	}
	async handleLeftArrowClick_() {
		this.statistic_.leftArrowClicked();
		if (this.firstPage) {
			this.showCover_()
		} else {
			return this.core_.navigatePrevPage()
		}
	}
	async handleRightArrowClick_() {
		this.statistic_.rightArrowClicked();
		if (this.showCover) {
			this.hideCover_()
		} else {
			return this.core_.navigateNextPage()
		}
	}
	async updateFontSize_(e) {
		const t = this.core_.getPresentationOptions();
		const o = t.fontSize + e;
		// await this.storage_.setFontSize(o);
		await this.core_.updatePresentationOptions({
			fontSize: o
		})
	}
	async handleMenuActionPlus_() {
		await this.updateFontSize_(1);
		this.statistic_.menuPlusClicked()
	}
	async handleMenuActionMinus_() {
		await this.updateFontSize_(-1);
		this.statistic_.menuMinusClicked()
	}
	async handleMenuActionNavigation_() {
		const [e, t] = await Promise.all([this.core_.getPackage(), this.bookmarks_.getBookmarks()]);
		const [o, a] = await Promise.all([e.getMetadata(), e.getTocTree()]);
		this.$["reader-bookmarks"].bookmarks = [...t];
		this.$["reader-navigation"].metadata = o;
		this.$["reader-navigation"].hidden = false;
		this.$["reader-toc-tree"].tocTree = a;
		this.statistic_.menuNavigationClicked()
	}
	async handleMenuActionMode_(e) {
		const t = e.detail;
		this.$["reader-menu"].mode = t;
		await this.core_.setRenderMode(t);
		await this.storage_.setRenderMode(t)
	}
	async handleTocTreeNavigateTocItem_(e) {
		this.statistic_.tocItemClicked();
		await this.core_.navigateHref(e.detail.href)
	}
	async handleBookmarksNavigateBookmark_(e) {
		this.statistic_.bookmarkClicked();
		await this.core_.navigateCfi(e.detail.cfi)
	}
	handleReaderCoreNavigateExternal_(e) {
		// yandex.browser.openPage(e.href, {
		// 	alt: e.options.altKey,
		// 	button: e.options.button,
		// 	ctrl: e.options.ctrlKey,
		// 	shift: e.options.shiftKey,
		// 	meta: e.options.metaKey
		// })
	}
	async handleReaderCoreProgressChanged_(e) {
		this.$["book-progress"].progress = e;
		this.statistic_.readerProgressChanged(e)
	}
	async handleReaderCorePageChanged_() {
		this.statistic_.readerPageChanged();
		await this.updateArrowVisibility_();
		await this.updateBookmarkLabelActivity_();
		await this.storage_.setPosition(await this.core_.getCurrentCfi())
	}
	async handleReaderCoreDocumentChanged_() {
		this.statistic_.readerDocumentChanged()
	}
	handleBookKeydown_(e) {
		const {
			key: t,
			ctrlKey: o
		} = e;
		const a = t === "PageUp" && !o;
		const r = t === "PageDown" && !o;
		const i = this.core_.getRenderMode();
		if (i === ReaderCoreInternal.RenderMode.PAGE) {
			if (t === "ArrowRight" || r || t === " ") {
				e.preventDefault();
				if (this.showCover) {
					this.hideCover_()
				} else {
					this.core_.navigateNextPage()
				}
			} else if (t === "ArrowLeft" || a) {
				e.preventDefault();
				this.core_.canNavigatePrevOrNext().then((e => {
					if (e.prev) {
						this.core_.navigatePrevPage()
					} else {
						this.showCover_()
					}
				}))
			}
		} else if (i === ReaderCoreInternal.RenderMode.SCROLL) {
			if (r || t === " ") {
				e.preventDefault();
				this.core_.navigateNextPage()
			} else if (a) {
				e.preventDefault();
				this.core_.navigatePrevPage()
			} else if (t === "ArrowDown") {
				e.preventDefault();
				this.core_.scrollBook(40)
			} else if (t === "ArrowUp") {
				e.preventDefault();
				this.core_.scrollBook(-40)
			}
		}
	}
	static async createCore_(e, t) {
		return ReaderCoreInternal.create({
			container: t,
			streamUrl: e.streamUrl,
			contentType: e.mimeType
		})
	}
}
ReaderPage.is = "reader-page";
ReaderPage.template = readerPageTemplate;
ReaderPage.properties = {
	firstPage: {
		type: Boolean,
		reflectToAttribute: true
	},
	lastPage: {
		type: Boolean,
		reflectToAttribute: true
	},
	loading: {
		type: Boolean,
		reflectToAttribute: true
	},
	menuOpen: {
		type: Boolean,
		observer: "observeMenuOpenChanged_",
		value: false
	},
	showCover: {
		type: Boolean,
		reflectToAttribute: true
	}
};
customElements.define(ReaderPage.is, ReaderPage);
export {
	BookFormat,
	StorageHandler,
	readerLoadTimeData
};
