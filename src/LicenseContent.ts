import { LicenseSpec, Options } from ".";
import CodedString from "./CodedString";
import Context from "./Context";
import Language from "./Language";
import * as languages from "./languages";
import loadLabels from "./loadLabels";
import { readFileP } from "./util";
import { ErrorBuffer } from "./util/errors";
import PromiseEach from "./util/PromiseEach";

export interface LicenseContentItem {
	body: {
		data: Buffer;
		type: "RTF " | "TEXT";
	};
	labels: Buffer;
	langs: Language[];
	languageIDs: number[];
}

interface LicenseContent {
	inOrder: LicenseContentItem[];
	byLanguageID: Map<number, LicenseContentItem>;
	defaultLanguageID: number;
}

namespace LicenseContent {
	/**
	 * Loads the license body text for the given `LicenseSpec`.
	 *
	 * @param langs - Languages that `spec` applies to.
	 */
	async function loadBody(
		spec: LicenseSpec,
		langs: Language[],
		context: Context
	): Promise<LicenseContentItem["body"]> {
		const fpath = spec.body.file && context.resolvePath(spec.body.file);

		return {
			data: CodedString.encode(
				fpath ?
				{
					charset: spec.body.charset || "UTF-8",
					data: await readFileP(fpath),
					encoding: spec.body.encoding
				} :
				{
					charset: spec.body.charset!,
					data: spec.body.text!,
					encoding: spec.body.encoding!
				},
				langs,
				context
			),
			type:
				spec.body.type ? (
					spec.body.type === "rtf" ?
					"RTF " :
					"TEXT"
				) :
				fpath ? (
					fpath.endsWith(".rtf") ?
					"RTF " :
					"TEXT"
				) :
				"TEXT"
		};
	}

	export async function load(
		specs: LicenseSpec[],
		optionsOrContext: Options | Context
	): Promise<LicenseContent> {
		const context = optionsOrContext instanceof Context ? optionsOrContext : new Context(optionsOrContext);

		const contents = await PromiseEach(specs.map(async spec => {
			const langs = languages.bySpec(spec);

			const [body, labels] = await PromiseEach([
				loadBody(spec, langs, context),
				loadLabels(spec, context, langs)
			]);

			return {
				body,
				labels,
				langs,
				languageIDs: langs.map(lang => lang.languageID),
				spec
			};
		}));

		if (!contents.length)
			throw new Error("No license specifications were provided.");

		const ret: LicenseContent = {
			byLanguageID: new Map(),
			defaultLanguageID: NaN,
			inOrder: contents
		};

		const langCollisions = new Set<Language>();
		const defaultLangs = new Set<Language>();

		for (const content of contents) {
			let contentWasUsed = false;

			for (const lang of content.langs) {
				const {languageID} = lang;

				if (ret.byLanguageID.has(languageID))
					langCollisions.add(lang);
				else {
					ret.byLanguageID.set(languageID, content);
					contentWasUsed = true;
				}
			}

			if (!contentWasUsed)
				continue;

			if (content.spec.default) {
				content.langs.forEach(defaultLangs.add.bind(defaultLangs));

				if (isNaN(ret.defaultLanguageID))
					ret.defaultLanguageID = content.langs[0].languageID;
			}

			delete content.spec;
		}

		const errors = new ErrorBuffer();

		if (langCollisions.size) {
			context.warning(
				new Error(`More than one license body was assigned to the language(s) ${
					Array.from(langCollisions).join(", ")
				}.`),
				errors
			);
		}

		if (isNaN(ret.defaultLanguageID))
			ret.defaultLanguageID = contents[0].langs[0].languageID;
		else if (defaultLangs.size > 1) {
			context.warning(
				new Error(`More than one language was designated as the default. Choosing ${
					languages.byLanguageID[ret.defaultLanguageID]
				}. Choices were ${
					Array.from(defaultLangs).join(", ")
				}.`),
				errors
			);
		}

		errors.check();
		return ret;
	}
}

export default LicenseContent;
