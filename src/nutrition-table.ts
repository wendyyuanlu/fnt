import {nutrients,type Nutrient} from './food-capture';

export const converterFields=['id','name',...nutrients,'weight','amount','unit'] as const;
export type ConverterField=typeof converterFields[number];
export const converterLabels:Record<ConverterField,string>={id:'Item ID',name:'Dish Name',calories:'Calories (kcal)',protein:'Protein (g)',fat:'Fat (g)',carbs:'Carbs (g)',sugar:'Sugar (g)',sodium:'Sodium (mg)',weight:'Grams',amount:'Amount',unit:'Unit'};
export type ConverterRow=Record<ConverterField,string>;
export interface ParsedNutritionTable{
  batch:string;headers:string[];rows:string[][];mapping:(ConverterField|'extra')[];
}
const cleanHeader=(value:string)=>value.trim().replace(/\*\*|__/g,'').toLowerCase().replace(/\s+/g,' ');
export function inferNutritionField(header:string):ConverterField|'extra'{
  const value=cleanHeader(header),canonical=converterFields.find(field=>cleanHeader(converterLabels[field])===value);
  if(canonical)return canonical;
  const aliases:Record<string,ConverterField>={'food':'name','food name':'name','name':'name','dish':'name','ingredient':'name','ingredient name':'name','calories':'calories','kcal':'calories','protein':'protein','fat':'fat','carbs':'carbs','carbohydrates':'carbs','sugar':'sugar','sugars':'sugar','sodium':'sodium','weight (g)':'weight','serving weight (g)':'weight','weight':'weight'};
  return aliases[value]??'extra';
}
export function strictNutritionNumber(text:string,label:string,required=true):number|undefined{
  if(!text.trim()){if(required)throw Error(`${label}: a value is required; blank is not zero.`);return;}
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text.trim()))throw Error(`${label}: use a finite nonnegative number, without units or separators.`);
  const value=Number(text);
  if(!Number.isFinite(value))throw Error(`${label}: the number is too large.`);
  return value;
}
function delimited(text:string,delimiter:string):string[][]{
  const rows:string[][]=[],row:string[]=[];let cell='',quoted=false,closed=false;
  const field=()=>{row.push(cell.trim());cell='';closed=false;};
  const record=()=>{field();if(row.some(value=>value!==''))rows.push([...row]);row.length=0;};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
      else cell+=char;
    }else if(char===delimiter)field();
    else if(char==='\n'||char==='\r'){if(char==='\r'&&text[i+1]==='\n')i++;record();}
    else if(char==='"'&&!cell){quoted=true;}
    else if(closed&&!/\s/.test(char))throw Error('Unexpected text after a quoted table cell.');
    else cell+=char;
  }
  if(quoted)throw Error('Unclosed quoted cell. Paste the complete CSV or TSV table.');
  if(cell||row.length)record();
  return rows;
}
function markdownLine(line:string):string[]{
  line=line.trim();if(line.startsWith('|'))line=line.slice(1);
  let finalSlashes=0;for(let i=line.length-2;i>=0&&line[i]==='\\';i--)finalSlashes++;
  if(line.endsWith('|')&&finalSlashes%2===0)line=line.slice(0,-1);
  const cells:string[]=[];let cell='';
  for(let i=0;i<line.length;i++){
    if(line[i]==='\\'&&(line[i+1]==='|'||line[i+1]==='\\'))cell+=line[++i];
    else if(line[i]==='|'){cells.push(cell.trim());cell='';}
    else cell+=line[i];
  }
  cells.push(cell.trim());return cells;
}
function htmlRecords(html:string):string[][]{
  if(typeof document==='undefined')throw Error('Copied HTML tables must be processed in the browser.');
  const template=document.createElement('template');template.innerHTML=html;
  const tables=template.content.querySelectorAll('table');
  if(tables.length!==1)throw Error('Copy exactly one HTML table, without nested tables.');
  return [...tables[0].rows].map(row=>[...row.cells].map(cell=>{
    if(cell.colSpan!==1||cell.rowSpan!==1)throw Error('Merged HTML cells are not supported. Paste a rectangular table.');
    return cell.textContent?.trim()??'';
  }));
}
function batchFrom(text:string):string{
  const found=[...text.matchAll(/^\s*(?:\*\*)?Batch ID\s*(?:\*\*)?\s*:\s*(?:\*\*)?([a-zA-Z0-9_.-]+)(?:\*\*)?\s*$/gmi)].map(match=>match[1]);
  if(found.length>1)throw Error('Include exactly one Batch ID above the table.');
  return found[0]??'';
}
export function parseNutritionTable(raw:string,html=''):ParsedNutritionTable{
  if(raw.length+html.length>2_000_000)throw Error('Paste a table smaller than 2 MB.');
  let records:string[][]=[];const batch=batchFrom(raw);
  if(html)records=htmlRecords(html);
  else{
    const lines=raw.replace(/^\uFEFF/,'').split(/\r?\n/);
    let delimiter='',start=-1;
    for(let index=0;index<lines.length;index++){
      const candidates=['\t',',','|'].filter(separator=>lines[index].includes(separator)).map(separator=>{
        let cells:string[];
        try{cells=separator==='|'?markdownLine(lines[index]):delimited(lines[index],separator)[0]??[];}
        catch{return{separator,score:0};}
        const fields=cells.map(inferNutritionField);
        return{separator,score:fields.includes('name')?fields.filter(field=>field!=='extra').length:0};
      }).sort((a,b)=>b.score-a.score);
      if(candidates[0]?.score){start=index;delimiter=candidates[0].separator;break;}
    }
    if(start<0)throw Error('No table header found. Include Dish Name and the nutrition column headings.');
    const body=lines.slice(start).filter(line=>!/^```/.test(line.trim())).join('\n');
    records=delimiter==='|'?body.split(/\r?\n/).filter(line=>line.trim()).map(markdownLine):delimited(body,delimiter);
    if(delimiter==='|'&&records[1]?.every(cell=>/^:?-{3,}:?$/.test(cell)))records.splice(1,1);
  }
  const headers=records.shift();
  if(!headers?.length||!records.length)throw Error('The table must include headings and at least one data row.');
  if(headers.length>128||records.length>5000)throw Error('The table exceeds 128 columns or 5,000 rows.');
  for(const [index,row]of records.entries())if(row.length!==headers.length)throw Error(`Table row ${index+1} has ${row.length} cells; expected ${headers.length}.`);
  return{batch,headers,rows:records,mapping:headers.map(inferNutritionField)};
}
export function mapNutritionTable(table:ParsedNutritionTable):ConverterRow[]{
  if(table.mapping.length!==table.headers.length)throw Error('Column mapping does not match the pasted table.');
  const assigned=table.mapping.filter(field=>field!=='extra');
  if(new Set(assigned).size!==assigned.length)throw Error('Map each destination field only once.');
  for(const field of ['name',...nutrients])if(!assigned.includes(field as ConverterField))throw Error(`Map the ${converterLabels[field as ConverterField]} column.`);
  table.mapping.forEach((field,index)=>{
    const header=table.headers[index].toLowerCase();
    const wrong=field==='calories'&&/\b(?:kj|j|joules?|g|mg)\b/.test(header)||field==='sodium'&&/\b(?:g|grams?|kg|oz|lb|salt|mcg|ug)\b/.test(header)||
      [...nutrients.filter(value=>value!=='sodium'&&value!=='calories'),'weight'].includes(field as Nutrient)&&/\b(?:mg|kg|oz|lb|mcg|ug|ml|liters?|kcal|kj)\b/.test(header);
    if(wrong)throw Error(`"${table.headers[index]}" has incompatible units. Convert the values explicitly before mapping.`);
  });
  return table.rows.map(cells=>{
    const row=Object.fromEntries(converterFields.map(field=>[field,''])) as ConverterRow;
    table.mapping.forEach((field,index)=>{if(field!=='extra')row[field]=cells[index];});
    return row;
  });
}
export function separateDescription(name:string):{name:string;description:string}{
  if(!name.endsWith(')'))return{name,description:''};
  let depth=0;
  for(let i=name.length-1;i>=0;i--){
    if(name[i]===')')depth++;
    else if(name[i]==='('&&--depth===0){
      if(i>0&&/\s/.test(name[i-1])&&name.slice(0,i).trim())return{name:name.slice(0,i).trimEnd(),description:name.slice(name.slice(0,i).trimEnd().length)};
      break;
    }
  }
  return{name,description:''};
}
