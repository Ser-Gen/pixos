import SevenZip from './7zz.es6.min.js';

var filteredDirs = [
  '.',
  '..',
  'tmp',
  'home',
  'dev',
  'proc',
  'archive',
];

// window.openFile = function name(url) {

export default name;

function name(data) {
  return new Promise(function (resolve, reject) {
    SevenZip().then(sevenZip => {
      data = new Uint8Array(data);
    const archiveName = "archive";
    const stream = sevenZip.FS.open(archiveName, "w+");
    sevenZip.FS.write(stream, data, 0, data.byteLength);
    sevenZip.FS.close(stream);

    sevenZip.callMain(["x", archiveName, '-oarchive-result']);
    console.log(sevenZip.FS.readdir('./archive-result').filter(dir => {
      return !filteredDirs.includes(dir);
    }));
    sevenZip.callMain(['a', '-tzip', 'archive.zip', './archive-result/*'])
    console.log(sevenZip.FS.readdir('./'));
    var zip = sevenZip.FS.readFile('./archive.zip');
    resolve(zip);

    // var file = new Blob([zip], {
    //   type: 'application/zip',
    // });
    // var url = URL.createObjectURL(file);
    // var a = document.createElement('a');
    // a.href = url;
    // a.download = 'arch';
    // a.innerHTML = 'arch';
    // document.body.append(a);
  })

// нужно скачивание сконвертированного архива
// удаление промежуточных файлов
// предпросмотр содержимого, хотя бы файловой структуры


//for(var i in sevenZip.FS) {
//  console.log(i);
//}

});

}
