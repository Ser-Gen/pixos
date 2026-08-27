// The whole test helper. There is no framework here on purpose: the project has no
// build step and no dependencies, and these run under plain `node tests/run.mjs`.

var failures = 0;
var checks = 0;

export function check (label, actual, expected) {
	checks++;
	var ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failures++;
	}
	console.log((ok ? '  ok   ' : '  FAIL ') + label
		+ (ok ? '' : '\n         got  ' + JSON.stringify(actual) + '\n         want ' + JSON.stringify(expected)));
}

export function report (name) {
	console.log(failures
		? '\n' + name + ': ' + failures + ' of ' + checks + ' failed'
		: '\n' + name + ': ' + checks + ' passed');
	return failures;
}
