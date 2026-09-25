/* Écriture de classeurs .xlsx (ZIP sans compression + XML), sans dépendance. */
/* ==========================================================================
   6. ÉCRITURE DE CLASSEURS EXCEL (.xlsx) — sans dépendance
   ========================================================================== */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0; }
  return t;
})();
function crc32(b){ let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=CRC_T[(c^b[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
const te = new TextEncoder();
/** ZIP « stored » (sans compression) — suffisant et parfaitement lisible par Excel */
function zipFiles(files){
  const parts=[], cd=[]; let off=0;
  const u16=n=>[n&255,(n>>8)&255], u32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];
  for(const f of files){
    const name=te.encode(f.name), data=f.data, crc=crc32(data);
    const lh=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),
      ...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)]);
    parts.push(lh,name,data);
    cd.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),
      ...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),
      ...u32(0),...u32(off)]),name);
    off+=lh.length+name.length+data.length;
  }
  let cdLen=0; for(const c of cd) cdLen+=c.length;
  const eocd=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),
    ...u32(cdLen),...u32(off),...u16(0)]);
  const all=[...parts,...cd,eocd];
  let total=0; for(const a of all) total+=a.length;
  const out=new Uint8Array(total); let p=0;
  for(const a of all){ out.set(a,p); p+=a.length; }
  return out;
}
const xe=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
function colName(n){ let s=''; n++; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }
/**
 * sheets : [{name, cols:[{t,w,fmt}], rows:[[v,…]], title?}]
 *   fmt : 'txt' | 'int' | 'dec' | 'h'
 */
export function buildXlsx(sheets){
  const STY={txt:0,int:2,dec:3,h:3};
  const sheetXml=(sh)=>{
    const nc=sh.cols.length;
    const cols=`<cols>${sh.cols.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.w||14}" customWidth="1"/>`).join('')}</cols>`;
    const head=`<row r="1" ht="22" customHeight="1">${sh.cols.map((c,i)=>
      `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xe(c.t)}</t></is></c>`).join('')}</row>`;
    const body=sh.rows.map((r,ri)=>`<row r="${ri+2}">${r.map((v,i)=>{
      const f=sh.cols[i]?.fmt||'txt';
      if(v==null||v==='') return '';
      if(f!=='txt'&&typeof v==='number'&&isFinite(v))
        return `<c r="${colName(i)}${ri+2}" s="${STY[f]}"><v>${v}</v></c>`;
      return `<c r="${colName(i)}${ri+2}" s="0" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(nc-1)}${sh.rows.length+1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${head}${body}</sheetData><autoFilter ref="A1:${colName(nc-1)}${sh.rows.length+1}"/></worksheet>`;
  };
  const files=[
    {name:'[Content_Types].xml',data:te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)},
    {name:'_rels/.rels',data:te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)},
    {name:'xl/workbook.xml',data:te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xe(s.name).slice(0,31)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`)},
    {name:'xl/_rels/workbook.xml.rels',data:te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)},
    {name:'xl/styles.xml',data:te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF175E82"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`)},
  ];
  sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:te.encode(sheetXml(s))}));
  return zipFiles(files);
}

