(function () {
	window.PIXOS_APP_CATALOG = {
	base: {
		name: 'base',
		files: [

			// COMMON
			'/apps/jquery-1.11.1.min.js',
			'/apps/jszip.3.10.1.min.js',
			'/apps/file-type.19.0.0.js',

			// EXPLORER
			'/apps/explorer/index.html',

			// ACE EDITOR
			'/apps/ace/index.html',
			'/apps/ace/pixos_supported',

			// 7ZIP
			'/apps/7z/main.js',
			'/apps/7z/7zz.wasm',
			'/apps/7z/7zz.es6.min.js',

			// APP MANAGER
			'/apps/app-manager/index.html',
			'/apps/app-catalog.js',
		],
	},
	ace: {
		name: 'ace',
		supportsText: true,
		files: [
			'/apps/ace/index.html',
			'/apps/ace/pixos_supported',
		]
	},
	terminal: {
		name: 'terminal',
		files: [
			'/apps/terminal/index.html',
			'/apps/terminal/autocomplete_menu.js',
			'/apps/terminal/jquery.terminal.min.css',
			'/apps/terminal/jquery.terminal.min.js',
			'/apps/terminal/pipe.js',
		],
	},
	monaco: {
		name: 'monaco',
		entryPath: '/apps/monaco-cdn/index.html',
		supportsText: true,
		files: [
			'/apps/monaco-cdn/index.html',
			'/apps/monaco-cdn/pixos_supported',
		]
	},
	tinymce: {
		name: 'tinymce',
		entryPath: '/apps/tinymce-cdn/index.html',
		supportedMimeTypes: ['text/html'],
		files: [
			'/apps/tinymce-cdn/index.html',
			'/apps/tinymce-cdn/pixos_supported',
		]
	},
	ffmpeg: {
		name: 'ffmpeg',
		files: [
			'/apps/ffmpeg.0.12.10/814.ffmpeg.js',
			'/apps/ffmpeg.0.12.10/ffmpeg-core.js',
			'/apps/ffmpeg.0.12.10/ffmpeg-core.wasm',
			'/apps/ffmpeg.0.12.10/ffmpeg.js',
			'/apps/ffmpeg.0.12.10/pixos_supported',
		],
	},
	mkvPlayer: {
		name: 'mkv player',
		entryPath: '/apps/mkv-player/index.html',
		files: [
			'/apps/mkv-player/index.html',
			'/apps/mkv-player/index.js',
			'/apps/mkv-player/pixos_supported',
		],
	},
	image: {
		name: 'image viewer',
		files: [
			'/apps/image/comparator.js',
			'/apps/image/diff_match_patch_uncompressed.js',
			'/apps/image/getDiffImgData.worker.js',
			'/apps/image/getDiffInline.js',
			'/apps/image/image-input.js',
			'/apps/image/index.html',
			'/apps/image/paste.js',
			'/apps/image/pixos_supported',
		],
	},
	ocr: {
		name: 'image OCR',
		files: [
			'/apps/ocr/worker.5.1.0.min.js',
			'/apps/ocr/index.html',
			'/apps/ocr/pixos_supported',
			'/apps/ocr/tesseract-core.js',
			'/apps/ocr/tesseract-core.wasm.js',
			'/apps/ocr/tesseract.5.1.0.min.js',
			'/apps/ocr/tesseract.5.min.js',
			'/apps/ocr/tesseract-core-simd-lstm.js',
			'/apps/ocr/tesseract-core-simd-lstm.wasm.js',
		],
	},
	photopea: {
		name: 'Photopea',
		files: [
			'/apps/photopea/index.html',
			'/apps/photopea/pixos_supported',
		],
	},
	yaReader: {
		name: 'Yandex Book Reader',
		entryPath: '/apps/ya-book-reader/index.html',
		files: [
			'/apps/ya-book-reader/index.css',
			'/apps/ya-book-reader/index.html',
			'/apps/ya-book-reader/index.js',
			'/apps/ya-book-reader/resources/polymer/v3_0/polymer/polymer_bundled.min.js',
			'/apps/ya-book-reader/resources/js/load_time_data.m.js',
			'/apps/ya-book-reader/resources/js/zip/zip.js',
			'/apps/ya-book-reader/resources/js/zip/inflate.js',
			'/apps/ya-book-reader/resources/js/zip/mime_types.js',
			'/apps/ya-book-reader/resources/js/zip/z_worker.js',
			'/apps/ya-book-reader/resources/js/reader_core/reader_core.js',
			'/apps/ya-book-reader/elements/reader_page/images/bookmark_icon.png',
			'/apps/ya-book-reader/elements/reader_page/images/arrow_left.png',
			'/apps/ya-book-reader/elements/reader_page/images/arrow_left_hover.png',
			'/apps/ya-book-reader/elements/reader_page/images/arrow_right.png',
			'/apps/ya-book-reader/elements/reader_page/images/arrow_right_hover.png',
			'/apps/ya-book-reader/pixos_supported',
		],
	},
	docx: {
		name: 'docx',
		files: [
			'/apps/docx/docx-preview.js',
			'/apps/docx/index.html',
			'/apps/docx/pixos_supported',
		]
	},
	sheetjs: {
		name: 'sheetjs',
		files: [
			'/apps/sheetjs/index.html',
			'/apps/sheetjs/pixos_supported',
			'/apps/sheetjs/sheet.js',
		]
	},
	luckySheet: {
		name: 'luckySheet',
		files: [
			'/apps/luckySheet/chartmix.css',
			'/apps/luckySheet/chartmix.umd.min.js',
			'/apps/luckySheet/echarts@4.8.0__dist__echarts.min.js',
			'/apps/luckySheet/element-ui@2.13.2__lib__index.js',
			'/apps/luckySheet/element-ui@2.13.2__lib__theme-chalk__index.css',
			'/apps/luckySheet/file.png',
			'/apps/luckySheet/fontawesome-webfont.woff2',
			'/apps/luckySheet/iconfont.css',
			'/apps/luckySheet/index.html',
			'/apps/luckySheet/luckyexcel.umd.js',
			'/apps/luckySheet/luckysheet.css',
			'/apps/luckySheet/luckysheet.umd.js',
			'/apps/luckySheet/plugin.js',
			'/apps/luckySheet/plugins.css',
			'/apps/luckySheet/pluginsCss.css',
			'/apps/luckySheet/unpkg.com__vuex@3.4.0__dist__vuex.min.js',
			'/apps/luckySheet/vue@2.6.11__dist__vue.min.js',
			'/apps/luckySheet/vuex@3.4.0__dist__vuex.min.js',
			'/apps/luckySheet/waffle_sprite.png',
			'/apps/luckySheet/pixos_supported',
		]
	},
	ppt: {
		name: 'ppt',
		files: [
			'/apps/ppt/index.html',
			'/apps/ppt/css/nv.d3.min.css',
			'/apps/ppt/css/pptxjs.css',
			'/apps/ppt/js/d3.min.js',
			'/apps/ppt/js/dingbat.js',
			'/apps/ppt/js/divs2slides.js',
			'/apps/ppt/js/divs2slides.min.js',
			'/apps/ppt/js/filereader.js',
			'/apps/ppt/js/jquery-1.11.3.min.js',
			'/apps/ppt/js/jquery.fullscreen-min.js',
			'/apps/ppt/js/jszip.min.js',
			'/apps/ppt/js/nv.d3.min.js',
			'/apps/ppt/js/pptxjs.js',
			'/apps/ppt/js/pptxjs.min.js',
			'/apps/ppt/pixos_supported',
		]
	},
	djvujs: {
		name: 'djvujs',
		files: [
			'/apps/djvujs/pixos_supported',
			'/apps/djvujs/djvu_viewer.js',
			'/apps/djvujs/djvu.js',
			'/apps/djvujs/index.html',
		]
	},
	emulatorjs: {
		name: 'EmulatorJS',
		files: [
			'/apps/emulatorjs/index.html',
			'/apps/emulatorjs/pixos_supported',
		],
	},
	ruffle: {
		name: 'ruffle',
		files: [
			'/apps/ruffle/25cc2cbaaa5f41229f38.wasm',
			'/apps/ruffle/core.ruffle.4023be96d56a3c732101.js',
			'/apps/ruffle/core.ruffle.4023be96d56a3c732101.js.map',
			'/apps/ruffle/index.html',
			'/apps/ruffle/LICENSE_APACHE',
			'/apps/ruffle/LICENSE_MIT',
			'/apps/ruffle/package.json',
			'/apps/ruffle/pixos_supported',
			'/apps/ruffle/README.md',
			'/apps/ruffle/ruffle.js',
			'/apps/ruffle/ruffle.js.LICENSE.txt',
			'/apps/ruffle/ruffle.js.map',
		]
	},
	tic80: {
		name: 'tic80',
		entryPath: '/apps/tic80-v1.1-html/index.html',
		files: [
			'/apps/tic80-v1.1-html/index.html',
			'/apps/tic80-v1.1-html/tic80.js',
			'/apps/tic80-v1.1-html/tic80.wasm',
			'/apps/tic80-v1.1-html/pixos_supported',
		]
	},
	pico8: {
		name: 'pico-8',
		files: [
			"/apps/pico8/favicon.ico",
			"/apps/pico8/index.html",
			"/apps/pico8/pico8_edu_0206b.js",
			"/apps/pico8/pixos_supported",
			"/apps/pico8/zoot_idle.gif",
			"/apps/pico8/zoot_talking.gif",
		],
	},
	jsdos: {
		name: 'JS-DOS',
		entryPath: '/apps/jsdosv7.5.0/index.html',
		files: [
			'/apps/jsdosv7.5.0/emulators-ui-loader.png',
			'/apps/jsdosv7.5.0/index.html',
			'/apps/jsdosv7.5.0/js-dos.css',
			'/apps/jsdosv7.5.0/js-dos.js',
			'/apps/jsdosv7.5.0/wdosbox.js',
			'/apps/jsdosv7.5.0/wdosbox.wasm',
			'/apps/jsdosv7.5.0/pixos_supported',
		],
	},
};
})();
