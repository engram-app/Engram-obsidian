/**
 * `no-restricted-syntax` selectors that keep untranslated English out of the UI.
 *
 * Every string a user can read goes through `t()` / `tInto()`, whose English
 * argument is the catalog key. A literal handed straight to a UI sink skips the
 * catalog, so no locale gate ever sees it: it ships in English to everyone.
 * Likewise an `Error.message` or `errMsg(e)` is English developer text (often a
 * server's), so it must not reach a sink or a `t()` variable; map the error with
 * `userErrorMessage()` (src/i18n/user-error.ts) instead.
 *
 * Shared by eslint.config.mts and tests/i18n-lint-sinks.test.ts.
 */

/** A string worth translating: two letters in a row ("5s" and "·" are not). */
const WORDY = "/[A-Za-z]{2}/";

/**
 * Literal values that are never translated. Keep this short and say why.
 * - URLs, with or without a scheme ("github.com/engram-app/engram"): addresses.
 * - Brand names: proper nouns that stay as-is in every locale.
 * - Example inputs shown as a placeholder: the literal format to type
 *   (an `engram_` key, ignore-pattern paths), not prose.
 */
const ALLOWED = String.raw`/^(https?:\/\/\S*|([\w-]+\.)+[a-z]{2,}(\/\S*)?|Engram|Obsidian|GitHub|Ko-fi|engram_abc123\.\.\.|drafts\/\nsecret\.md)$/`;

const LITERAL = `Literal[value=${WORDY}]:not([value=${ALLOWED}])`;
const TEMPLATE = `TemplateLiteral:has(> TemplateElement[value.raw=${WORDY}])`;
const ERROR_TEXT = `:matches(MemberExpression[property.name="message"], CallExpression[callee.name="errMsg"])`;

/** How a value reaches a sink: as the argument itself, or a step or two inside it. */
const WRAPPERS = [
	"",
	"ConditionalExpression > ",
	"ConditionalExpression > ConditionalExpression > ",
	"LogicalExpression > ",
	'BinaryExpression[operator="+"] > ',
	'BinaryExpression[operator="+"] > BinaryExpression[operator="+"] > ',
];

/** Attributes a user reads (tooltip, screen reader, placeholder, alt text). */
const PROSE_ATTRS = "title|aria-label|aria-description|placeholder|alt";

const METHOD_SINKS =
	"setName|setDesc|setButtonText|setTooltip|setPlaceholder|setTitle|setText|appendText|setMessage";

/** The node a sink receives its text through; append a value selector. */
const SINKS = [
	'NewExpression[callee.name="Notice"] > ',
	`CallExpression[callee.property.name=/^(${METHOD_SINKS})$/] > `,
	`CallExpression:matches([callee.name=/^create(El|Div|Span)$/], [callee.property.name=/^create(El|Div|Span)$/]) > ObjectExpression > Property[key.name="text"] > `,
	'CallExpression[callee.property.name="addCommand"] > ObjectExpression > Property[key.name="name"] > ',
	// attr: { title, "aria-label", placeholder, alt } on createEl/createDiv/createSpan.
	`Property[key.name="attr"] > ObjectExpression > Property:matches([key.name=/^(${PROSE_ATTRS})$/], [key.value=/^(${PROSE_ATTRS})$/]) > `,
];

const LITERAL_MESSAGE =
	"User-visible text must go through t()/tInto() so it reaches the locale catalogs. Allowed literals (URLs, brand names) are listed in scripts/eslint-i18n-sinks.ts.";
const ERROR_MESSAGE =
	"Error text is English developer text: map it with userErrorMessage() (src/i18n/user-error.ts) before it reaches the UI, and keep the raw message for logs.";

export const I18N_RESTRICTED_SYNTAX: Array<{ selector: string; message: string }> = [
	...SINKS.flatMap((sink) =>
		WRAPPERS.flatMap((wrap) => [
			{ selector: `${sink}${wrap}${LITERAL}`, message: LITERAL_MESSAGE },
			{ selector: `${sink}${wrap}${TEMPLATE}`, message: LITERAL_MESSAGE },
		]),
	),
	// Error text anywhere inside a sink's argument, however deeply wrapped.
	...SINKS.map((sink) => ({
		selector: `${sink.replace(/ > $/, " ")}${ERROR_TEXT}`,
		message: ERROR_MESSAGE,
	})),
	// setAttribute/setAttr(name, value): the value, when the attribute is one a user reads.
	...[LITERAL, TEMPLATE].map((value) => ({
		selector: `CallExpression[callee.property.name=/^(setAttribute|setAttr)$/][arguments.0.value=/^(${PROSE_ATTRS})$/] > ${value}:nth-child(2)`,
		message: LITERAL_MESSAGE,
	})),
	// addRibbonIcon(icon, title, cb): only the title is prose; the icon is an id.
	{
		selector: `CallExpression[callee.property.name="addRibbonIcon"] > ${LITERAL}:nth-child(2)`,
		message: LITERAL_MESSAGE,
	},
	// t("Sync failed: {reason}", { reason: e.message }) splices English into a translated sentence.
	{
		selector: `CallExpression:matches([callee.name="t"], [callee.name="tInto"]) > ObjectExpression ${ERROR_TEXT}`,
		message: ERROR_MESSAGE,
	},
];
