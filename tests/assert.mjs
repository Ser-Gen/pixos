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

// Sets the exit code as well as returning the count. Most files end with
// `process.exit(report(name) ? 1 : 0)`, but five ended with a bare `report(name)`, and a file
// that does that exits 0 whatever failed -- `tests/run.mjs` goes by the exit status, so their
// FAIL lines scrolled past a summary that said every file passed. Setting it here means
// forgetting the `process.exit` can no longer hide a failure.
export function report (name) {
	console.log(failures
		? '\n' + name + ': ' + failures + ' of ' + checks + ' failed'
		: '\n' + name + ': ' + checks + ' passed');
	if (failures) {
		process.exitCode = 1;
	}
	return failures;
}
