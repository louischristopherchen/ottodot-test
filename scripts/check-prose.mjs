// Fails when any tracked text file contains an em dash or a filler word from the
// house writing rules. Run by `npm run lint:prose` and in CI.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EM_DASH = /—|&mdash;/;
const FILLER = /\b(robust|seamless(ly)?|cutting-edge|leverag(e|es|ed|ing)|delve|unlock(s|ed|ing)?|streamlin(e|es|ed|ing)|comprehensive|it is worth noting|worth noting that)\b/i;

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
	.split('\n')
	.filter((file) => file && !file.endsWith('package-lock.json') && !/\.(png|jpg|jpeg|gif|ico|woff2?|zip)$/i.test(file))
	// This file names the words it looks for.
	.filter((file) => file !== 'scripts/check-prose.mjs');

const problems = [];
for (const file of files) {
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		continue;
	}
	text.split('\n').forEach((line, index) => {
		if (EM_DASH.test(line)) {
			problems.push(`${file}:${index + 1}: em dash`);
		}
		const filler = FILLER.exec(line);
		if (filler) {
			problems.push(`${file}:${index + 1}: filler word "${filler[0]}"`);
		}
	});
}

if (problems.length > 0) {
	console.error(problems.join('\n'));
	console.error(`\n${problems.length} prose problem(s). Use a colon, comma or parentheses instead of an em dash, and plain words instead of filler.`);
	process.exit(1);
}
console.log(`Prose check passed (${files.length} files).`);
