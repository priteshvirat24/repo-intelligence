import * as zlib from 'zlib';
import { BriefSourceType } from '@repo/shared';

// Turns an uploaded brief into plain text. Everything here treats the file as untrusted bytes:
// sizes are capped before and after decompression, and nothing in the document is executed.

export const MAX_BRIEF_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BRIEF_CHARS = 200_000;
// word/document.xml of a very long brief is a few MB; anything far larger is a zip bomb
const MAX_DOCX_XML_BYTES = 25 * 1024 * 1024;

export class BriefParseError extends Error {}

export interface ParsedBrief {
  text: string;
  sourceType: BriefSourceType;
  truncated: boolean;
}

export function briefSourceType(filename: string): BriefSourceType | null {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (ext === 'txt') return 'text';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  return null;
}

export async function parseBriefFile(filename: string, buffer: Buffer): Promise<ParsedBrief> {
  if (buffer.length > MAX_BRIEF_FILE_BYTES) {
    throw new BriefParseError(`The file is larger than ${MAX_BRIEF_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  const sourceType = briefSourceType(filename);
  if (!sourceType) {
    throw new BriefParseError('Unsupported file type. Upload a .txt, .md, .pdf or .docx brief.');
  }

  let text: string;
  if (sourceType === 'pdf') text = await pdfText(buffer);
  else if (sourceType === 'docx') text = docxText(buffer);
  else text = plainText(buffer);

  return finishBrief(text, sourceType);
}

export function finishBrief(raw: string, sourceType: BriefSourceType): ParsedBrief {
  const text = raw
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < 40) {
    throw new BriefParseError('The brief has almost no readable text. Paste it as text, or upload a file with selectable text.');
  }
  const truncated = text.length > MAX_BRIEF_CHARS;
  return { text: truncated ? text.slice(0, MAX_BRIEF_CHARS) : text, sourceType, truncated };
}

function plainText(buffer: Buffer): string {
  const sample = buffer.subarray(0, 4096);
  if (sample.includes(0)) {
    throw new BriefParseError('This does not look like a text file.');
  }
  return buffer.toString('utf8');
}

async function pdfText(buffer: Buffer): Promise<string> {
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new BriefParseError('This file is not a valid PDF.');
  }
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    await parser.load();
    const result = await parser.getText();
    return result.text || '';
  } catch {
    throw new BriefParseError('The PDF could not be read. It may be encrypted or damaged.');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Text of word/document.xml. A DOCX is a zip; only the one entry we need is located and inflated. */
export function docxText(buffer: Buffer): string {
  const xml = readZipEntry(buffer, 'word/document.xml');
  if (xml === null) {
    throw new BriefParseError('This file is not a valid .docx document.');
  }
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(?:br|cr)\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) => {
      switch (entity) {
        case 'lt': return '<';
        case 'gt': return '>';
        case 'amp': return '&';
        case 'quot': return '"';
        case 'apos': return "'";
        default: {
          const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
          return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
        }
      }
    });
}

function readZipEntry(buffer: Buffer, entryName: string): string | null {
  // End of central directory record: last 22 bytes plus an optional comment of up to 64 KB
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === entryName) {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (data.length !== compressedSize) return null;
      if (method === 0) return data.toString('utf8');
      if (method !== 8) return null;
      try {
        return zlib.inflateRawSync(data, { maxOutputLength: MAX_DOCX_XML_BYTES }).toString('utf8');
      } catch {
        throw new BriefParseError('The document is too large or damaged to read.');
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** First heading or first line of the brief, for a default title. */
export function titleFromBrief(text: string, filename?: string | null): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length >= 4);
  const fromFile = filename ? filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() : '';
  const title = (firstLine && firstLine.length <= 120 ? firstLine : '') || fromFile || (firstLine || '').slice(0, 100);
  return title || 'Untitled brief';
}
