import { BadRequestException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import {
  ContextFileExtractService,
  hashFile,
  htmlToMarkdown,
  normalizeText,
  titleFromFilename,
} from './context-file-extract.service';

/** Minimal but structurally valid PDF holding one line of text. */
function buildPdf(text: string): Buffer {
  const escape = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${escape(text)}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let content = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(content, 'utf8'));
    content += object;
  }

  const xrefStart = Buffer.byteLength(content, 'utf8');
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    content += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  content +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(content, 'utf8');
}

/**
 * Minimal .docx: the three parts every reader looks for, plus a styles table
 * so `Heading1` resolves to the style name mammoth maps onto `<h1>`.
 */
function buildDocx(
  paragraphs: Array<{ styleId?: string; styleName?: string; text: string }>,
): Buffer {
  const xml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const body = paragraphs
    .map((paragraph) => {
      const properties = paragraph.styleId
        ? `<w:pPr><w:pStyle w:val="${paragraph.styleId}"/></w:pPr>`
        : '';
      return (
        `<w:p>${properties}<w:r><w:t xml:space="preserve">` +
        `${xml(paragraph.text)}</w:t></w:r></w:p>`
      );
    })
    .join('');

  const styles = paragraphs
    .filter((p) => p.styleId && p.styleName)
    .map(
      (p) =>
        `<w:style w:type="paragraph" w:styleId="${p.styleId}">` +
        `<w:name w:val="${p.styleName}"/><w:qFormat/></w:style>`,
    )
    .join('');

  const zip = new AdmZip();
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `</Types>`,
      'utf8',
    ),
  );
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
      'utf8',
    ),
  );
  zip.addFile(
    'word/_rels/document.xml.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
      'utf8',
    ),
  );
  zip.addFile(
    'word/styles.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        styles +
        `</w:styles>`,
      'utf8',
    ),
  );
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${body}</w:body></w:document>`,
      'utf8',
    ),
  );
  return zip.toBuffer();
}

function buildZip(files: Record<string, Buffer | string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(
      name,
      Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    );
  }
  return zip.toBuffer();
}

describe('ContextFileExtractService', () => {
  const svc = new ContextFileExtractService();

  describe('plain text formats', () => {
    it('passes markdown through untouched', async () => {
      const markdown = '# Escalation\n\nNever diagnose over chat.';
      const result = await svc.extract('guide.md', Buffer.from(markdown));
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].text).toBe(markdown);
      expect(result.skipped).toEqual([]);
    });

    it('accepts .txt and .markdown as well', async () => {
      for (const name of ['notes.txt', 'notes.markdown', 'notes.text']) {
        const result = await svc.extract(name, Buffer.from('body text'));
        expect(result.documents[0].text).toBe('body text');
      }
    });
  });

  describe('format rejection', () => {
    it('rejects an unsupported extension with the supported list', async () => {
      await expect(
        svc.extract('logo.png', Buffer.from('not really a png')),
      ).rejects.toThrow(BadRequestException);
      await expect(
        svc.extract('logo.png', Buffer.from('not really a png')),
      ).rejects.toThrow(/not a supported format/);
    });

    it('explains how to fix a legacy .doc', async () => {
      await expect(
        svc.extract('old.doc', Buffer.from('binary')),
      ).rejects.toThrow(/save as \.docx/);
    });

    it('rejects a file with no extension', async () => {
      await expect(svc.extract('README', Buffer.from('hello'))).rejects.toThrow(
        /not a supported format/,
      );
    });
  });

  describe('pdf', () => {
    it('extracts the text layer', async () => {
      const buffer = buildPdf('Replace the brush head every three months.');
      const result = await svc.extract('brushing.pdf', buffer);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].text).toContain(
        'Replace the brush head every three months.',
      );
    });

    it('rejects a PDF with no extractable text', async () => {
      const buffer = buildPdf('x');
      await expect(svc.extract('scan.pdf', buffer)).rejects.toThrow(
        /no extractable text/,
      );
    });

    it('reports an unreadable PDF as a 400 rather than a crash', async () => {
      await expect(
        svc.extract('broken.pdf', Buffer.from('%PDF-1.4 not really')),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('docx', () => {
    it('extracts the document text', async () => {
      const buffer = buildDocx([
        { text: 'Fees are payable before treatment.' },
        { text: 'Members receive a ten percent discount.' },
      ]);
      const result = await svc.extract('fees.docx', buffer);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].text).toContain(
        'Fees are payable before treatment.',
      );
      expect(result.documents[0].text).toContain(
        'Members receive a ten percent discount.',
      );
    });

    it('turns Word headings into markdown headings the splitter can use', async () => {
      const buffer = buildDocx([
        { styleId: 'Heading1', styleName: 'heading 1', text: 'Escalation' },
        { text: 'Never diagnose over chat.' },
      ]);
      const result = await svc.extract('ethics.docx', buffer);
      expect(result.documents[0].text).toMatch(/^#\s+Escalation/m);
    });
  });

  describe('archives', () => {
    it('expands a zip into one document per supported entry', async () => {
      const buffer = buildZip({
        'brand.md': '# Voice\nWarm and plain.',
        'fees.txt': 'Prices are published on the site.',
        'logo.png': 'binary-ish',
      });
      const result = await svc.extract('bundle.zip', buffer);
      expect(result.documents.map((d) => d.filename)).toEqual([
        'brand.md',
        'fees.txt',
      ]);
      expect(result.documents[0].text).toContain('Warm and plain.');
    });

    it('ignores macOS resource-fork noise', async () => {
      const buffer = buildZip({
        'guide.md': '# Guide\nBody.',
        '__MACOSX/._guide.md': 'junk',
        '.DS_Store': 'junk',
      });
      const result = await svc.extract('bundle.zip', buffer);
      expect(result.documents.map((d) => d.filename)).toEqual(['guide.md']);
    });

    it('skips entries it cannot read instead of failing the archive', async () => {
      const buffer = buildZip({
        'good.md': '# Good\nBody.',
        'notes.rtf': '{\\rtf1 unsupported}',
      });
      const result = await svc.extract('bundle.zip', buffer);
      expect(result.documents.map((d) => d.filename)).toEqual(['good.md']);
      expect(result.skipped).toEqual(['notes.rtf']);
    });

    it('rejects an archive with nothing importable', async () => {
      const buffer = buildZip({ 'logo.png': 'binary', 'data.bin': 'x' });
      await expect(svc.extract('assets.zip', buffer)).rejects.toThrow(
        /no documents in a supported format/,
      );
    });

    it('rejects a file that is not really a zip', async () => {
      await expect(
        svc.extract('bundle.zip', Buffer.from('PK not really')),
      ).rejects.toThrow(/could not be opened as a zip/);
    });

    it('rejects an empty archive', async () => {
      await expect(svc.extract('bundle.zip', buildZip({}))).rejects.toThrow(
        /contains no files/,
      );
    });
  });

  describe('html', () => {
    it('converts headings to ATX markdown', async () => {
      const result = await svc.extract(
        'page.html',
        Buffer.from('<h2>Referral</h2><p>Send to the nearest clinic.</p>'),
      );
      expect(result.documents[0].text).toContain('## Referral');
    });
  });
});

describe('extraction helpers', () => {
  it('htmlToMarkdown emits ATX headings, not setext underlines', () => {
    // The section splitter only recognises `# Heading`; setext `===` would
    // silently collapse a whole document into one unretrievable piece.
    const markdown = htmlToMarkdown('<h1>One</h1><h2>Two</h2><p>Body</p>');
    expect(markdown).toContain('# One');
    expect(markdown).toContain('## Two');
    expect(markdown).not.toContain('===');
    expect(markdown).not.toContain('---');
  });

  it('htmlToMarkdown keeps lists readable', () => {
    const markdown = htmlToMarkdown('<ul><li>First</li><li>Second</li></ul>');
    // turndown pads the marker; what matters is that each entry survives as
    // its own bullet line rather than being flattened into prose.
    expect(markdown).toMatch(/^-\s+First$/m);
    expect(markdown).toMatch(/^-\s+Second$/m);
  });

  it('normalizeText strips control bytes and collapses blank lines', () => {
    const input = 'line one\r\nline two\u0000\u0007\n\n\n\nline three\n';
    const output = normalizeText(input);
    expect(output).toBe('line one\nline two\n\nline three');
  });

  it('normalizeText tolerates nullish input', () => {
    expect(normalizeText(undefined as unknown as string)).toBe('');
  });

  it('titleFromFilename derives a readable title', () => {
    expect(titleFromFilename('q3-pricing_guide.pdf')).toBe('Q3 Pricing Guide');
    expect(titleFromFilename('/tmp/uploads/Visit Fees.docx')).toBe(
      'Visit Fees',
    );
    expect(titleFromFilename('notes')).toBe('Notes');
    expect(titleFromFilename('')).toBe('Untitled');
    expect(titleFromFilename('.hidden')).toBe('Untitled');
  });

  it('titleFromFilename preserves acronyms that are already uppercase', () => {
    // Only casing already present in the name can be detected as an acronym —
    // `hipaa-policy.md` is indistinguishable from any other word and gets
    // title-cased, which is the honest behaviour rather than guessing.
    expect(titleFromFilename('HIPAA-policy.md')).toBe('HIPAA Policy');
    expect(titleFromFilename('hipaa-policy.md')).toBe('Hipaa Policy');
  });

  it('hashFile is stable for identical bytes and differs otherwise', () => {
    expect(hashFile(Buffer.from('abc'))).toBe(hashFile(Buffer.from('abc')));
    expect(hashFile(Buffer.from('abc'))).not.toBe(hashFile(Buffer.from('abd')));
    expect(hashFile(Buffer.from('abc'))).toHaveLength(64);
  });
});
