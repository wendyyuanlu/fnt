import { compare,displayFormula,Engine,maySpill,scalar,type Ast } from './formula';
import { allSheets,allTables, clone,createTranslationContext,getCell,isFault,key,mapAst,tableAt,translate,type Sheet,type Table,type TranslationContext,type Workbook } from './model';

function relativeRow(ast:Ast):boolean{
  if(ast.kind==='ref')return !ast.absRow;
  if(ast.kind==='binary')return relativeRow(ast.left)||relativeRow(ast.right);
  if(ast.kind==='unary'||ast.kind==='spill')return relativeRow(ast.child);
  if(ast.kind==='range')return relativeRow(ast.start)||relativeRow(ast.end);
  return ast.kind==='call'&&ast.args.some(relativeRow);
}
function columnNormalizer(book:Workbook,sheet:Sheet,column:string,target:string,context:TranslationContext){
  const invariant=new WeakMap<Ast,boolean>(),normalized=new Map<string,{formula:Ast;signature:string}>();
  return(source:Ast,row:string)=>{
    let stable=invariant.get(source);
    if(stable===undefined){stable=!relativeRow(source);invariant.set(source,stable);}
    // Same-column translations with absolute rows depend on the target table, not the source row.
    const id=stable?JSON.stringify(source):undefined,cached=id===undefined?undefined:normalized.get(id);
    if(cached)return cached;
    const formula=translate(source,book,sheet.id,row,column,target,column,sheet.id,context),result={formula,signature:JSON.stringify(formula)};
    if(id!==undefined)normalized.set(id,result);
    return result;
  };
}
export function tableColumnFormulas(book:Workbook,table:Table,column:string,context?:TranslationContext):{row:string;formula:Ast}[]{
  const sheet=allSheets(book).find(s=>s.id===table.sheet);
  if(!sheet||!table.columns.some(c=>c.column===column))throw Error('This table column no longer exists.');
  const first=table.rows[0];if(!first)return[];
  const seen=new Set<string>(),result:{row:string;formula:Ast}[]=[];
  const normalize=columnNormalizer(book,sheet,column,first,context??createTranslationContext(book));
  for(const row of table.rows){
    const cell=getCell(sheet,row,column),source=cell.formula??cell.calculation;if(!source)continue;
    const {formula,signature}=normalize(source,row);
    if(!seen.has(signature)){seen.add(signature);result.push({row,formula});}
  }
  return result;
}
export function applyTableColumnFormula(book:Workbook,table:Table,column:string,formula:Ast,scope:'matching'|'calculated'|'all',source?:Ast,translation?:TranslationContext):void{
  const sheet=allSheets(book).find(s=>s.id===table.sheet),first=table.rows[0];
  if(!sheet||!first||!table.columns.some(c=>c.column===column))throw Error('Add a data row before editing this table column.');
  if(scope==='matching'&&!source)throw Error('Choose the existing formula pattern to modify.');
  const context=translation??createTranslationContext(book),normalize=scope==='matching'?columnNormalizer(book,sheet,column,first,context):undefined;
  const signature=scope==='matching'?JSON.stringify(source):undefined;
  let changed=0;
  for(const row of table.rows){
    const cell=getCell(sheet,row,column),prior=cell.formula??cell.calculation;
    if(normalize&&(!prior||normalize(prior,row).signature!==signature))continue;
    if(scope==='calculated'&&!cell.formula&&!cell.calculation&&(cell.binding||cell.value!=null&&cell.value!==''||cell.note||cell.link))continue;
    const next=translate(formula,book,sheet.id,first,column,row,column,sheet.id,context);
    if(scope!=='all'&&cell.calculation&&!cell.formula){sheet.cells[key(row,column)]={...clone(cell),calculation:next};changed++;continue;}
    restoreCalculation(book,sheet,row,column,next);changed++;
  }
  if(!changed)throw Error('No data cells match this formula scope.');
}

/** A supplied engine must have current metadata/structure and be invalidated for intervening cell edits. */
export function columnCalculations(book:Workbook,sheet:Sheet,row:string,column:string,engine?:Engine,context?:TranslationContext):{row:string;formula:Ast}[]{
  const cell=getCell(sheet,row,column);
  if(cell.calculation)return[{row,formula:cell.calculation}];
  const table=tableAt(book,sheet.id,row,column);if(!table||table.header===row)return[];
  if(engine&&engine.book!==book)throw Error('Calculation engine belongs to a different workbook.');
  const marker=table.columns.find(c=>['ismeal','isday'].includes(c.name.toLowerCase())),label=table.columns.find(c=>['meal','weight'].includes(c.name.toLowerCase()));
  if(marker||label)engine??=new Engine(book);
  const header=(id:string)=>marker?scalar(engine!.cell(sheet.id,id,marker.column))===true:label?!!scalar(engine!.cell(sheet.id,id,label.column)):false;
  const sameKind=header(row),seen=new Set<string>(),result:{row:string;formula:Ast}[]=[];
  const normalize=columnNormalizer(book,sheet,column,row,context??createTranslationContext(book)),texts=new Map<Ast,string>();
  for(const id of table.rows){
    if(id===row)continue;
    const source=getCell(sheet,id,column),template=source.formula??source.calculation;if(!template)continue;
    if(header(id)!==sameKind)continue;
    const {formula}=normalize(template,id);
    let text=texts.get(formula);if(text===undefined){text=displayFormula(formula,book);texts.set(formula,text);}
    if(!seen.has(text)){seen.add(text);result.push({row:id,formula});}
  }
  return result;
}
export function restoreCalculation(book:Workbook,sheet:Sheet,row:string,column:string,formula:Ast):void{
  const cell=clone(getCell(sheet,row,column));
  delete cell.value;delete cell.binding;delete cell.calculation;delete cell.link;
  cell.formula=clone(formula);cell.original=displayFormula(formula,book);cell.spillHint=maySpill(formula);
  sheet.cells[key(row,column)]=cell;
}
export function quantityDiagnostic(book:Workbook,sheet:Sheet,row:string,column:string,engine=new Engine(book)):string|undefined{
  const cell=getCell(sheet,row,column);if(!cell.formula)return;
  const table=tableAt(book,sheet.id,row,column);if(!table||table.header===row)return;
  const field=(name:string)=>table.columns.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(!['amount (g)','grams'].includes(table.columns.find(c=>c.column===column)?.name.toLowerCase()??''))return;
  const amount=field('Amount'),unit=field('Unit'),ingredient=field('Ingredient')??field('Food');if(!amount||!unit||!ingredient)return;
  const dependencies=new Set<string>();mapAst(cell.formula,n=>{if(n.kind==='structured')dependencies.add(n.table);return n;});
  const conversions=allTables(book).find(t=>dependencies.has(t.id)&&['From Unit','To Unit','Conversion Factor'].every(name=>t.columns.some(c=>c.name===name)));
  if(!conversions)return;
  const read=(id:string)=>scalar(engine.cell(sheet.id,row,id)),unitValue=read(unit.column),amountValue=read(amount.column);
  if(isFault(unitValue)||isFault(amountValue))return 'The amount or unit has a reference/calculation error.';
  if(amountValue===null&&unitValue===null)return;
  if(typeof amountValue!=='number'||!Number.isFinite(amountValue))return 'Enter a numeric Amount; for fractions, use Fraction quantity formatting.';
  if(compare(unitValue,'g')===0)return;
  if(typeof unitValue!=='string'||!unitValue)return 'Choose a conversion unit, or enter grams manually.';
  const source=allTables(book).find(t=>dependencies.has(t.id)&&['Conversion Unit','Conversion Amount','Serving (g)'].every(name=>t.columns.some(c=>c.name===name)));
  if(!source)return 'The original ingredient conversion source is unavailable. Reconnect its source or enter grams manually.';
  const sourceSheet=allSheets(book).find(s=>s.id===source.sheet)!,nameColumn=source.columns.find(c=>['ingredients','ingredient'].includes(c.name.toLowerCase()));
  if(!nameColumn)return 'The ingredient name field is unavailable.';
  const chosen=read(ingredient.column);
  // Match ordinary textual lookups in source order; never replace XLOOKUP semantics.
  const record=source.rows.find(id=>compare(scalar(engine.cell(sourceSheet.id,id,nameColumn.column)),chosen)===0);
  if(!record)return 'This ingredient has no conversion data. Choose an ingredient with serving information, or enter grams manually.';
  const info=(name:string)=>scalar(engine.cell(sourceSheet.id,record,source.columns.find(c=>c.name===name)!.column));
  const base=info('Conversion Unit'),serving=info('Serving (g)'),conversionAmount=info('Conversion Amount');
  if(typeof base!=='string'||!base||typeof serving!=='number'||serving<=0||typeof conversionAmount!=='number'||conversionAmount<=0)return 'The ingredient needs a conversion unit, positive Serving (g), and positive Conversion Amount.';
  if(compare(unitValue,base)===0)return;
  const from=conversions.columns.find(c=>c.name==='From Unit')!,to=conversions.columns.find(c=>c.name==='To Unit')!,factor=conversions.columns.find(c=>c.name==='Conversion Factor')!;
  const rule=conversions.rows.find(id=>compare(scalar(engine.cell(conversions.sheet,id,from.column)),unitValue)===0&&compare(scalar(engine.cell(conversions.sheet,id,to.column)),base)===0);
  if(!rule)return `Missing universal conversion: ${unitValue} to ${base}. Add that rule, or enter grams manually. Ingredient-specific serving conversions are separate.`;
  const value=scalar(engine.cell(conversions.sheet,rule,factor.column));
  if(typeof value!=='number'||value<=0)return 'The matching conversion rule needs a positive numeric factor.';
}
