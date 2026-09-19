// Copyright (c) 2025-2026 Everyday Labs S LLC

import { FieldType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  decodePlaceholderValue,
  parseFieldMetaFromPlaceholder,
  parsePlaceholderInnerContent,
  parsePlaceholderMetaProperties,
} from './helpers';

describe('parsePlaceholderMetaProperties', () => {
  it('parses unquoted values= with pipes as one property', () => {
    expect(parsePlaceholderMetaProperties('values=Yes|No|Maybe')).toEqual({
      values: 'Yes|No|Maybe',
    });
  });

  it('parses quoted values= containing commas as one property', () => {
    expect(
      parsePlaceholderMetaProperties(
        'values="Income > $200k, joint|Net worth > $1M, excluding residence", label=Basis',
      ),
    ).toEqual({
      values: 'Income > $200k, joint|Net worth > $1M, excluding residence',
      label: 'Basis',
    });
  });

  it('does not treat pipe-outside-quotes as separate quoted options', () => {
    // Malformed authoring — only the first quoted segment is decoded; rest is junk.
    expect(parsePlaceholderMetaProperties('values="Option A"|"Option B"')).toEqual({
      values: 'Option A"|"Option B',
    });
  });
});

describe('parseFieldMetaFromPlaceholder checkbox/radio values', () => {
  it('splits pipe-separated values into checkbox options', () => {
    const meta = parseFieldMetaFromPlaceholder({ values: 'Yes|No' }, FieldType.CHECKBOX);

    expect(meta?.values).toEqual([
      { id: 1, value: 'Yes', checked: false },
      { id: 2, value: 'No', checked: false },
    ]);
  });

  it('supports legacy options= alias', () => {
    const meta = parseFieldMetaFromPlaceholder({ options: 'A|B' }, FieldType.RADIO);

    expect(meta?.values).toEqual([
      { id: 1, value: 'A', checked: false },
      { id: 2, value: 'B', checked: false },
    ]);
  });

  it('parses full placeholder with quoted multi-option values', () => {
    const parsed = parsePlaceholderInnerContent(
      'checkbox, r1, values="Option A, with comma|Option B", label=Example, required=true',
    );

    expect(parsed?.rawFieldMeta.values).toBe('Option A, with comma|Option B');

    const meta = parseFieldMetaFromPlaceholder(parsed!.rawFieldMeta, FieldType.CHECKBOX);

    expect(meta?.values).toEqual([
      { id: 1, value: 'Option A, with comma', checked: false },
      { id: 2, value: 'Option B', checked: false },
    ]);
  });
});

describe('decodePlaceholderValue', () => {
  it('decodes %20 and LaTeX escaped percent', () => {
    expect(decodePlaceholderValue('25%25%2B')).toBe('25%+');
    expect(decodePlaceholderValue('100\\%+')).toBe('100%+');
  });
});
