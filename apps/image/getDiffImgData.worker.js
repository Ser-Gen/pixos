importScripts('./diff_match_patch_uncompressed.js');
importScripts('./getDiffInline.js');

onmessage = function (e) {
	// var a = UPNG.decode(e.data.images.a);
	// var b = UPNG.decode(e.data.images.b);
	var a = e.data.images.a;
	var b = e.data.images.b;

	// a.data = new Uint8Array(UPNG.toRGBA8(a)[0]);
	// b.data = new Uint8Array(UPNG.toRGBA8(b)[0]);

	var data = prepareData({
		a: a,
		b: b,
	});
	var result = getDiffImg(data);

	if (result.png) {
		postMessage(
			result, [
				result.png.data.buffer,
				result.pngInline.data.buffer,
			]
		);
	}

	// если картинки всё-таки не отличаются,
	// отправим только инфу об этом
	else {
		postMessage(result);
	}
}

function getDiffImg (cfg) {
	var png1 = cfg.a;
	var png2 = cfg.b;

	var w = png1.width;
	var h = png1.height >= png2.height ? png1.height : png2.height;

	var data = new Uint8Array(w * h * 4);
	var isDifferent = false;
	var isDiffInLine = false;
	var isDiffDot = false;

	var leftTop = [
		png1.width, png1.height
	];
	var rightBottom = [
		0, 0
	];
	var diffLines = {};
	var diffCounter = 0;
	var percent = 0;

	for (var i = 0; i < data.length; i+=4) {
		isDiffDot = false;

		if (i % (w * 4) === 0) {
			isDiffInLine = false;
		};

		if (
			(
				png1.data.length < i
				|| png2.data.length < i
				|| png1.data[i] !== png2.data[i]
				|| png1.data[i + 1] !== png2.data[i + 1]
				|| png1.data[i + 2] !== png2.data[i + 2]
			)
		) {
			if (leftTop[0] > Math.floor(i / 4) % w) {
				leftTop[0] = Math.floor(i / 4) % w;
			}
			if (leftTop[1] > Math.floor(i / 4 / w)) {
				leftTop[1] = Math.floor(i / 4 / w);
			}

			if (rightBottom[0] < Math.floor(i / 4) % w) {
				rightBottom[0] = Math.floor(i / 4) % w;
			}
			if (rightBottom[1] < Math.floor(i / 4 / w)) {
				rightBottom[1] = Math.floor(i / 4 / w);
			}

			if (!isDiffInLine) {
				if (w >= Math.floor(i / 4) % w + 1) {
					diffLines[Math.floor(i / 4 / w)] = [
						Math.floor(i / 4) % w,
						Math.floor(i / 4) % w + 1
					];
				}
			}
			else if (diffLines[Math.floor(i / 4 / w)]) {
				diffLines[Math.floor(i / 4 / w)][1] = Math.floor(i / 4) % w;
			};

			isDifferent = true;
			isDiffInLine = true;
			isDiffDot = true;
		}

		if (
			isDiffDot
			|| (
				(i % (w * 4) > (w * 4 - 5 * 4))
				&& isDiffInLine
			)
		) {
			data[i] = 255;
			data[i + 1] = 0;
			data[i + 2] = 0;
			data[i + 3] = 255;

			diffCounter++;

			continue;
		};

		data[i] = png1.data[i];
		data[i + 1] = png1.data[i + 1];
		data[i + 2] = png1.data[i + 2];
		data[i + 3] = 255;
	};

	if (!isDifferent) {
		return {
			isDifferent: isDifferent
		};
	}

	if (leftTop[0] === rightBottom[0]) {
		if (rightBottom[0] === w) {
			leftTop[0]--;
		}
		else {
			rightBottom[0]++;
		}
	}

	if (leftTop[1] === rightBottom[1]) {
		if (rightBottom[1] === h) {
			leftTop[1]--;
		}
		else {
			rightBottom[1]++;
		}
	}

	percent = diffCounter / (data.length / 4);

	var clippingMinX;
	var clippingMaxX;

	Object.keys(diffLines).forEach(function (y) {
		var line = diffLines[y];

		if (
			clippingMinX === undefined
			|| clippingMinX > line[0]
		) {
			clippingMinX = line[0];
		}

		if (
			clippingMaxX === undefined
			|| clippingMaxX < line[1]
		) {
			clippingMaxX = line[1];
		}
	});

	if (clippingMinX) {
		leftTop[0] = clippingMinX;
	}
	if (clippingMaxX) {
		rightBottom[0] = clippingMaxX;
	}

	var rightBottom1 = Math.min(rightBottom[1], png1.height - 1);
	var rightBottom2 = Math.min(rightBottom[1], png2.height - 1);

	var pngToInlineWidth = rightBottom[0] - leftTop[0];
	var png1ToInlineHeight = rightBottom1 - leftTop[1];
	var png2ToInlineHeight = rightBottom2 - leftTop[1];

	if (png1ToInlineHeight < 0) {
		png1ToInlineHeight = 0;
	}
	if (png2ToInlineHeight < 0) {
		png2ToInlineHeight = 0;
	}

	// объекты кадрированных изображений
	var pngToInline1 = {
		width: pngToInlineWidth,
		height: png1ToInlineHeight,
		data: new Uint8ClampedArray(pngToInlineWidth * png1ToInlineHeight * 4),
	}

	var pngToInline2 = {
		width: pngToInlineWidth,
		height: png2ToInlineHeight,
		data: new Uint8ClampedArray(pngToInlineWidth * png2ToInlineHeight * 4),
	}

	// кадрируем картинки
	for (var y = leftTop[1], i = 0; y < rightBottom1; y++) {
		for (var x = leftTop[0]; x < rightBottom[0]; x++) {
			pngToInline1.data[i++] = png1.data[y * png1.width * 4 + x * 4 + 0];
			pngToInline1.data[i++] = png1.data[y * png1.width * 4 + x * 4 + 1];
			pngToInline1.data[i++] = png1.data[y * png1.width * 4 + x * 4 + 2];
			pngToInline1.data[i++] = png1.data[y * png1.width * 4 + x * 4 + 3];
		}
	};

	for (var y = leftTop[1], i = 0; y < rightBottom2; y++) {
		for (var x = leftTop[0]; x < rightBottom[0]; x++) {
			pngToInline2.data[i++] = png2.data[y * png2.width * 4 + x * 4 + 0];
			pngToInline2.data[i++] = png2.data[y * png2.width * 4 + x * 4 + 1];
			pngToInline2.data[i++] = png2.data[y * png2.width * 4 + x * 4 + 2];
			pngToInline2.data[i++] = png2.data[y * png2.width * 4 + x * 4 + 3];
		}
	};

	// ищем совпадения с конца
	var i = 1;

	while (

		// пока не вышли за картинку
		pngToInline1.data.length - i >= 0
		&& pngToInline2.data.length - i >= 0
		
		// пока все точки одинаковые
		&& pngToInline1.data[pngToInline1.data.length - i - 3] === pngToInline2.data[pngToInline2.data.length - i - 3]
		&& pngToInline1.data[pngToInline1.data.length - i - 2] === pngToInline2.data[pngToInline2.data.length - i - 2]
		&& pngToInline1.data[pngToInline1.data.length - i - 1] === pngToInline2.data[pngToInline2.data.length - i - 1]
		&& pngToInline1.data[pngToInline1.data.length - i] === pngToInline2.data[pngToInline2.data.length - i]
	) {
		i += 4;
	}

	i--;

	// кадрируем снизу
	// синхронизируем высоту
	pngToInline1.data = pngToInline1.data.subarray(0, pngToInline1.data.length - (Math.floor(i / 4 / pngToInlineWidth) * 4 * pngToInlineWidth));
	pngToInline2.data = pngToInline2.data.subarray(0, pngToInline2.data.length - (Math.floor(i / 4 / pngToInlineWidth) * 4 * pngToInlineWidth));

	pngToInline1.height = Math.floor(pngToInline1.data.length / 4 / pngToInlineWidth);
	pngToInline2.height = Math.floor(pngToInline2.data.length / 4 / pngToInlineWidth);

	// сравниваем
	var result = getDiff(
		pngToInline1,
		pngToInline2,
	);

	if (!result.isDifferent) {
		return {
			isDifferent: result.isDifferent
		};
	}

	return {
		isDifferent: isDifferent,
		percent: percent,
		png: {
			data: data,
			width: w,
			height: h,
		},
		pngInline: {
			data: result.data.data,
			width: result.data.width,
			height: result.data.height,
			offset: leftTop,
		},
	}
};

function prepareData (cfg) {
	if (!cfg) {
		return;
	}

	if (cfg.a.width === cfg.b.width) {
		return {
			a: cfg.a,
			b: cfg.b
		};
	}

	var wide;
	var thin;
	var newThinData;
	var wideWidth;
	var thinWidth;
	var thinOffset;
	var length;
	var isABigger;
	var thinCounter;
	var i = 0;
	var line = -1;
	var j;

	if (cfg.a.width > cfg.b.width) {
		wide = cfg.a;
		thin = cfg.b;
		isABigger = true;
	}
	else {
		wide = cfg.b;
		thin = cfg.a;
		isABigger = false;
	}

	wideWidth = wide.width * 4;
	thinWidth = thin.width * 4;
	thinOffset = wideWidth - thinWidth;

	length = wide.width * thin.height * 4;
	newThinData = new Uint8ClampedArray(length);

	for (; i < length;i++) {
		if (i % wideWidth === 0) {
			thinCounter = thinWidth;
			line++;
		};

		if (thinCounter) {
			newThinData[i] = thin.data[i - line * thinOffset];
			thinCounter--;
		}
		else {
			for (j = 0; j < thinOffset; j++) {
				newThinData[i + j] = 255;
			}
		}
	}

	thin = {
		width: wide.width,
		height: thin.height,
		data: newThinData
	};

	if (isABigger) {
		return {
			a: wide,
			b: thin
		}
	}
	else {
		return {
			a: thin,
			b: wide
		}
	}
}
