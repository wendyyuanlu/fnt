export function parseTsv(text:string):string[][] {
  const rows:string[][]=[],row:string[]=[];let field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"'){quoted=false;closed=true;}else field+=c;
    }else if(c==='"'&&!field&&!closed)quoted=true;
    else if(c==='\t'){row.push(field);field='';closed=false;}
    else if(c==='\r'||c==='\n'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field);rows.push([...row]);row.length=0;field='';closed=false;
    }else{
      if(closed)throw Error('Unexpected text after a quoted clipboard field.');
      field+=c;
    }
  }
  if(quoted)throw Error('Clipboard text has an unclosed quoted field.');
  if(field||row.length||closed||!rows.length){row.push(field);rows.push(row);}
  return rows;
}
export function serializeTsv(rows:string[][]):string {
  return rows.map(row=>row.map(cell=>/[\t\r\n"]/.test(cell)?`"${cell.replace(/"/g,'""')}"`:cell).join('\t')).join('\r\n');
}
