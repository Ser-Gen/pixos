export default class WM {
	constructor (cfg) {
		if (typeof cfg.root === 'undefined') {
			throw 'need root, read source'
		}

		var _this = this;

		this.root = cfg.root;
		this.rootContent = $('<div></div>').appendTo('body');
		this.winID = 0;
		this.layoutConfig = cfg.config || {
			content: [{
				type: 'row',
				isClosable: false,
				content:[]
			}]
		};

		$('head').append(`<style>
			[data-goldenlayout-contid] {
				position: absolute;
				z-index: 100;
			}
			[data-goldenlayout-winid] {
				width: 100%;
				height: 100%;
			}</style>
		`);

		this.myLayout = new GoldenLayout(this.layoutConfig, $(this.root));
		this.myLayout.registerComponent('PixOS', function( container, state ){
			container.getElement().html(state.html);
		});
		this.myLayout.init();

		this.initialised = cfg.initialised || function () {};

		this.stateChanged = cfg.stateChanged || function () {
			document.querySelectorAll(`[data-goldenlayout-winid]`).forEach(kuk => {
				var id = kuk.dataset.goldenlayoutWinid;
				var cont = document.querySelector(`[data-goldenlayout-contid="${id}"]`);
				var rect = kuk.getBoundingClientRect();

				cont.style.top = rect.top +'px';
				cont.style.left = rect.left +'px';
				cont.style.width = rect.width +'px';
				cont.style.height = rect.height +'px';

				if (kuk.closest('.lm_maximised')) {
					cont.style.zIndex = '101';
				}
				else {
					cont.style.zIndex = '';
				}
			});

			document.querySelectorAll(`[data-goldenlayout-contid]`).forEach(cont => {
				var id = cont.dataset.goldenlayoutContid;
				var win = document.querySelector(`[data-goldenlayout-winid="${id}"]`);

				if (!win) {
					cont.remove();
				}
			});
		};

		this.myLayout.on('initialised', this.initialised);
		this.myLayout.on('stateChanged', this.stateChanged);

		window.onresize = function () {
			_this.myLayout.updateSize();
		};
	}

	openWindow (cfg) {
		var newID = this.winID++;
		
		var newConfig = {
			title: cfg.title || 'title',
			type: cfg.type || 'component',
			componentName: cfg.name || 'PixOS',
			componentState: { html: cfg.html || `<div data-goldenlayout-winid="${newID}"></div>` }
		};

		this.myLayout.root.contentItems[0].addChild(newConfig);

		this.rootContent.append($(cfg.content).attr('data-goldenlayout-contid', newID));
	};
}
