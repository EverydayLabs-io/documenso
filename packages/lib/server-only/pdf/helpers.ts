import path from 'node:path';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { FontLibrary } from '@documenso/skia-canvas';
import type { Recipient } from '@prisma/client';
import { FieldType } from '@prisma/client';
import { match } from 'ts-pattern';

/**
 * Ensure all required fonts are registered in the skia-canvas FontLibrary.
 *
 * Fonts are registered once per process and retained — calling this multiple
 * times is a no-op after the first invocation.
 */
export const ensureFontLibrary = () => {
  const fontPath = path.join(process.cwd(), 'public/fonts');

  if (!FontLibrary.has('Caveat')) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    FontLibrary.use({
      ['Caveat']: [path.join(fontPath, 'caveat.ttf')],
    });
  }

  if (!FontLibrary.has('Inter')) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    FontLibrary.use({
      ['Inter']: [path.join(fontPath, 'inter-variablefont_opsz,wght.ttf')],
    });
  }

  if (!FontLibrary.has('Noto Sans')) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    FontLibrary.use({
      ['Noto Sans']: [path.join(fontPath, 'noto-sans.ttf')],
      ['Noto Sans Japanese']: [path.join(fontPath, 'noto-sans-japanese.ttf')],
      ['Noto Sans Chinese']: [path.join(fontPath, 'noto-sans-chinese.ttf')],
      ['Noto Sans Korean']: [path.join(fontPath, 'noto-sans-korean.ttf')],
    });
  }
};

type RecipientPlaceholderInfo = {
  email: string;
  name: string;
  recipientIndex: number;
};

/*
  Parse field type string to FieldType enum.
  Normalizes the input (uppercase, trim) and validates it's a valid field type.
  This ensures we handle case variations and whitespace, and provides clear error messages.
*/
export const parseFieldTypeFromPlaceholder = (fieldTypeString: string): FieldType => {
  const normalizedType = fieldTypeString.toUpperCase().trim();

  return match(normalizedType)
    .with('SIGNATURE', () => FieldType.SIGNATURE)
    .with('FREE_SIGNATURE', () => FieldType.FREE_SIGNATURE)
    .with('INITIALS', () => FieldType.INITIALS)
    .with('NAME', () => FieldType.NAME)
    .with('EMAIL', () => FieldType.EMAIL)
    .with('DATE', () => FieldType.DATE)
    .with('TEXT', () => FieldType.TEXT)
    .with('NUMBER', () => FieldType.NUMBER)
    .with('RADIO', () => FieldType.RADIO)
    .with('CHECKBOX', () => FieldType.CHECKBOX)
    .with('DROPDOWN', () => FieldType.DROPDOWN)
    .otherwise(() => {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: `Invalid field type: ${fieldTypeString}`,
      });
    });
};

const PLACEHOLDER_QUOTE_CHARS = new Set(['"', "'", '\u201c', '\u201d', '\u2018', '\u2019']);

const isPlaceholderQuoteChar = (char: string) => PLACEHOLDER_QUOTE_CHARS.has(char);

const matchingPlaceholderQuote = (openQuote: string): string => {
  return match(openQuote)
    .with('"', () => '"')
    .with("'", () => "'")
    .with('\u201c', () => '\u201d')
    .with('\u2018', () => '\u2019')
    .otherwise(() => openQuote);
};

/*
  Decode a placeholder property value: optional quotes, optional %20 encoding.
*/
export const decodePlaceholderValue = (value: string): string => {
  let decoded = value.trim();

  if (decoded.length >= 2) {
    const open = decoded[0];
    const close = decoded[decoded.length - 1];

    if (isPlaceholderQuoteChar(open) && close === matchingPlaceholderQuote(open)) {
      decoded = decoded.slice(1, -1);
    }
  }

  decoded = decoded.replace(/\\%/g, '%');

  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
};

/*
  Parse comma-separated key=value pairs, respecting quoted strings.
*/
export const parsePlaceholderMetaProperties = (metaString: string): Record<string, string> => {
  const properties: Record<string, string> = {};
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  const pushProperty = () => {
    const trimmed = current.trim();

    if (!trimmed) {
      current = '';
      return;
    }

    const eqIndex = trimmed.indexOf('=');

    if (eqIndex === -1) {
      current = '';
      return;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();

    properties[key] = decodePlaceholderValue(rawValue);
    current = '';
  };

  for (let index = 0; index < metaString.length; index += 1) {
    const char = metaString[index];

    if (inQuotes) {
      current += char;

      if (char === matchingPlaceholderQuote(quoteChar) && metaString[index - 1] !== '\\') {
        inQuotes = false;
        quoteChar = '';
      }

      continue;
    }

    if (isPlaceholderQuoteChar(char)) {
      inQuotes = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (char === ',') {
      pushProperty();
      continue;
    }

    current += char;
  }

  pushProperty();

  return properties;
};

export type ParsedPlaceholderInnerContent = {
  fieldTypeString: string;
  recipient: string;
  rawFieldMeta: Record<string, string>;
};

/*
  Parse placeholder inner content: FIELD, rN, key=value, ...
*/
export const parsePlaceholderInnerContent = (innerContent: string): ParsedPlaceholderInnerContent | undefined => {
  const matchResult = innerContent.match(/^([^,]+),\s*(r\d+)(?:,\s*(.*))?$/i);

  if (!matchResult) {
    return;
  }

  return {
    fieldTypeString: matchResult[1].trim(),
    recipient: matchResult[2].trim(),
    rawFieldMeta: parsePlaceholderMetaProperties(matchResult[3] ?? ''),
  };
};

/*
  Transform raw field metadata from placeholder format to schema format.
  Users should provide properly capitalized property names (e.g., readOnly, fontSize, textAlign).
  Converts string values to proper types (booleans, numbers).
*/
const parseSelectionValuesFromPlaceholder = (
  raw: string,
  fieldType: FieldType,
): Array<{ id: number; value: string; checked: boolean } | { value: string }> => {
  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (fieldType === FieldType.DROPDOWN) {
    return parts.map((value) => ({ value }));
  }

  return parts.map((value, index) => ({
    id: index + 1,
    value,
    checked: false,
  }));
};

export const parseFieldMetaFromPlaceholder = (
  rawFieldMeta: Record<string, string>,
  fieldType: FieldType,
): Record<string, unknown> | undefined => {
  if (fieldType === FieldType.SIGNATURE || fieldType === FieldType.FREE_SIGNATURE) {
    return;
  }

  if (Object.keys(rawFieldMeta).length === 0) {
    return;
  }

  const fieldTypeString = String(fieldType).toLowerCase();

  const parsedFieldMeta: Record<string, unknown> = {
    type: fieldTypeString,
  };

  /*
    rawFieldMeta is an object with string keys and string values.
    It contains string values because the PDF parser returns the values as strings.

    E.g. { 'required': 'true', 'fontSize': '12', 'maxValue': '100', 'minValue': '0', 'characterLimit': '100' }
  */
  const rawFieldMetaEntries = Object.entries(rawFieldMeta);

  for (const [property, value] of rawFieldMetaEntries) {
    /*
      CHECKBOX/RADIO/DROPDOWN selection lists are expanded after the loop from
      `values=` or legacy `options=` (pipe-separated: Opt1|Opt2).
    */
    if (property === 'values' || property === 'options') {
      continue;
    }

    if (property === 'readOnly' || property === 'required') {
      parsedFieldMeta[property] = value === 'true';
    } else if (
      property === 'fontSize' ||
      property === 'maxValue' ||
      property === 'minValue' ||
      property === 'characterLimit'
    ) {
      const numValue = Number(value);

      if (!Number.isNaN(numValue)) {
        parsedFieldMeta[property] = numValue;
      }
    } else {
      parsedFieldMeta[property] = value;
    }
  }

  if (fieldType === FieldType.CHECKBOX || fieldType === FieldType.RADIO || fieldType === FieldType.DROPDOWN) {
    const selectionRaw = rawFieldMeta.values ?? rawFieldMeta.options;

    if (selectionRaw) {
      parsedFieldMeta.values = parseSelectionValuesFromPlaceholder(selectionRaw, fieldType);
    }
  }

  return parsedFieldMeta;
};

const extractRecipientPlaceholder = (placeholder: string): RecipientPlaceholderInfo => {
  const indexMatch = placeholder.match(/^r(\d+)$/i);

  if (!indexMatch) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: `Invalid recipient placeholder format: ${placeholder}. Expected format: r1, r2, r3, etc.`,
    });
  }

  const recipientIndex = Number(indexMatch[1]);

  return {
    email: `recipient.${recipientIndex}@documenso.com`,
    name: `Recipient ${recipientIndex}`,
    recipientIndex,
  };
};

/*
  Finds a recipient based on a placeholder reference.
  If recipients array is provided, uses index-based matching (r1 -> recipients[0], etc.).
  Otherwise, uses email-based matching from createdRecipients.
*/
export const findRecipientByPlaceholder = (
  recipientPlaceholder: string,
  placeholder: string,
  recipients: Pick<Recipient, 'id' | 'email'>[] | undefined,
  createdRecipients: Pick<Recipient, 'id' | 'email'>[],
): Pick<Recipient, 'id' | 'email'> => {
  if (recipients && recipients.length > 0) {
    /*
      Map placeholder by index: r1 -> recipients[0], r2 -> recipients[1], etc.
      recipientIndex is 1-based, so we subtract 1 to get the array index.
    */
    const { recipientIndex } = extractRecipientPlaceholder(recipientPlaceholder);
    const recipientArrayIndex = recipientIndex - 1;

    if (recipientArrayIndex < 0 || recipientArrayIndex >= recipients.length) {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: `Recipient placeholder ${recipientPlaceholder} (index ${recipientIndex}) is out of range. Provided ${recipients.length} recipient(s).`,
      });
    }

    return recipients[recipientArrayIndex];
  }

  /*
    Use email-based matching for placeholder recipients.
  */
  const { email } = extractRecipientPlaceholder(recipientPlaceholder);
  const recipient = createdRecipients.find((r) => r.email === email);

  if (!recipient) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: `Could not find recipient ID for placeholder: ${placeholder}`,
    });
  }

  return recipient;
};
