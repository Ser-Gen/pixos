function getDiff (img0, img1) {
	var img0Data = new Uint8ClampedArray(img0.data.buffer);
	var img1Data = new Uint8ClampedArray(img1.data.buffer);
	
	var img0Text = imgToText(img0Data, img0.width);
	var img1Text = imgToText(img1Data, img0.width);
	
	var diff = lineMode(img0Text, img1Text);
	
	diff = trimDiff(diff);

	if (!diff.length) {
		return {
			isDifferent: false,
		}
	}
	
	var diffHeight = 0;

	for (var i = 0; i < diff.length; i++) {
		diff[i] = strToData(diff[i]);
	}
	
	var data = diffToData(diff, img0.width, diffHeight);
	
	return {
		isDifferent: true,
		data: data,
	};
	

	// собираем картинку результата сравнения из кусочков
	function diffToData (diff, width, height) {
		var data = new Uint8ClampedArray(width * height * 4);
		var currentOffset = 0;

		diff.forEach(i => {
			data.set(i, currentOffset);
			currentOffset += i.length;
		});
		
		return {
			data: data,
			width: width,
			height: height,
		};
	}
	
	// преобразование картинки в строку
	function imgToText (data, width) {
		var result = '';
		var currentOffset = 0;
		
		// получаем строку
		// заменяем элементы со значением 10
		// потому что их код совпадает с кодом символа перевода строки
		// https://stackoverflow.com/questions/6965107/converting-between-strings-and-arraybuffers
		while (currentOffset < data.length) {
			result += String.fromCharCode.apply(null, data.subarray(currentOffset, currentOffset + width * 4)).replace(/\n/g, String.fromCharCode(300)) +'\n';
			currentOffset += width * 4;
		}
		
		return result;
	}
	
	// построчное сравнение
	// https://github.com/google/diff-match-patch/wiki/Line-or-Word-Diffs
	function lineMode(text1, text2) {
		var dmp = new diff_match_patch();
		var a = dmp.diff_linesToChars_(text1, text2);
		var lineText1 = a.chars1;
		var lineText2 = a.chars2;
		var lineArray = a.lineArray;
		var diffs = dmp.diff_main(lineText1, lineText2, false);
		
		dmp.diff_charsToLines_(diffs, lineArray);
		
		// СДЕЛАТЬ
		// изучить необходимость этого
		dmp.diff_cleanupEfficiency(diffs);

		// медленно и ломает строки
		// dmp.diff_cleanupSemantic(diffs);
		//dmp.diff_cleanupSemantic(diffs);
		return diffs;
	}
	
	// обратное преобразование кусочков картинки из строки в массив
	function strToData (str) {
		var type = str[0];

		// убираем переводы строки, возвращаем элементы, пересекающиеся с символом перевода сроки
		var dataStr = str[1].replace(/\n/g, '').replace(new RegExp(String.fromCharCode(300), 'g'), '\n');

		// наполняет массив кусочка картинки из строки
		var arr = new Uint8ClampedArray(dataStr.length);

		for (let index = 0; index < dataStr.length; index++) {
			arr[index] = dataStr.charCodeAt(index);
		}

		// количество строк
		var lineCount = arr.length / (img0.width * 4);
		var shift = 10;
		
		// подсветка отличий
		if (type === -1) {
			for (var j = 0; j < arr.length; j+=4) {

				// подкрашиваем красным
				arr[j + 1] = arr[j + 1] - shift;
				arr[j + 2] = arr[j + 2] - shift;
			};
		}
		if (type === 1) {
			for (var j = 0; j < arr.length; j+=4) {

				// подкрашиваем зелёным
				arr[j] = arr[j] - shift;
				arr[j + 2] = arr[j + 2] - shift;
			};
		}
		
		// выставляем метки отличий по краю картинки
		if (
			img0.width * 4 > 24
			&& type === 1
		) {
			for (var i = 0; i < arr.length; i+=img0.width * 4) {
				arr.set([0,255,0,255,0,255,0,255,0,255,0,255,0,255,0,255], i);
			}
		}
		if (
			img0.width * 4 > 24
			&& type === -1
		) {
			for (var i = 0; i < arr.length; i+=img0.width * 4) {
				arr.set([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255], i);
			}
		}
		
		diffHeight += lineCount;
		
		return arr;
	}
	
	// убираем неизменное с начала и с конца файла
	function trimDiff (diff) {
		var diffStart = 0;
		var diffEnd = 0;
		
		for (var i = 0; i < diff.length; i++) {
			diffStart = i;
			
			if (diff[i][0] !== 0) {
				break;
			}
		}
		
		for (var i = diff.length - 1; i >= 0; i--) {
			diffEnd = diff.length - 1 - i;
			
			if (diff[i][0] !== 0) {
				break;
			}
		}
		
		return diff.slice(diffStart, diff.length - diffEnd);
	}
}
