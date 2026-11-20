import { expect,it } from 'vitest';
import { Engine,flatten,compile } from '../src/formula';
import { blankSheet,setInput,key,renameColumn,move,uid,type Workbook,type Sheet } from '../src/model';

function fixture(){
  const book:Workbook={schema:1,id:uid(),title:'Invented expected cases',revision:0,sheets:[],tables:[],names:[],pickerSources:{}};
  function table(name:string,headers:string[],rows:string[][]):Sheet{
    const s=blankSheet(name,20,12);book.sheets.push(s);
    book.tables.push({id:uid(),name,sheet:s.id,header:s.rows[0].id,rows:rows.map((_,i)=>s.rows[i+1].id),columns:headers.map((name,i)=>({id:uid(),column:s.columns[i].id,name}))});
    [headers,...rows].forEach((row,r)=>row.forEach((value,c)=>setInput(book,s,s.rows[r].id,s.columns[c].id,value)));return s;
  }
  const ingredients=table('Ingredients',['Ingredient','Serving','Calories','ConversionUnit','ConversionAmount','PerGram'],[
    ['Test grain','100','200','tsp','10','=[@Calories]/[@Serving]'],
    ['Test beans','100','80','g','100','=[@Calories]/[@Serving]']]);
  table('Convert',['From','To','Factor'],[['tbsp','tsp','3'],['cup','tbsp','16']]);
  const grams='=IF([@Unit]="g",[@Amount],[@Amount]*INDEX(FILTER(Convert[Factor],(Convert[From]=[@Unit])*(Convert[To]=XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[ConversionUnit]))),1)/XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[ConversionAmount])*XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[Serving]))';
  const calories='=XLOOKUP([@Ingredient],Ingredients[Ingredient],Ingredients[PerGram],"")*[@Grams]';
  const total='=LET(pos,ROW()-ROW(INDEX(Meals[Meal],1))+1,start,pos+1,last,IFERROR(XMATCH(TRUE,INDEX(Meals[isMeal],start):INDEX(Meals[isMeal],ROWS(Meals[Meal])),0)+pos-1,ROWS(Meals[Meal])),SUM(INDEX(Meals[Calories],start):INDEX(Meals[Calories],last))/[@Portions])';
  const meals=table('Meals',['Meal','Ingredient','Amount','Unit','Grams','Calories','Portions','isMeal'],[
    ['Test lunch','','','','',total,'2','TRUE'],
    ['','Test grain','50','g',grams,calories,'','FALSE'],
    ['','Test beans','150','g',grams,calories,'','FALSE'],
    ['Test dinner','','','','',total,'1','TRUE'],
    ['','Test beans','300','g',grams,calories,'','FALSE'],
    ['','Test grain','2','tbsp',grams,calories,'','FALSE']]);
  const log=table('Master',['Date','Weight','Food','Grams','Calories','isDay'],[
    ['=DATE(2025,5,5)','x','','','=SUM(INDEX(Master[Calories],2):INDEX(Master[Calories],4))','TRUE'],
    ['=A2','','Test lunch','1','=IFERROR(XLOOKUP([@Food],Meals[Meal],Meals[Calories]),XLOOKUP([@Food],Ingredients[Ingredient],Ingredients[PerGram],"")*[@Grams])','FALSE'],
    ['=A2','','Test grain','50','=IFERROR(XLOOKUP([@Food],Meals[Meal],Meals[Calories]),XLOOKUP([@Food],Ingredients[Ingredient],Ingredients[PerGram],"")*[@Grams])','FALSE'],
    ['=A2','','Manual dish','','500','FALSE'],
    ['=A2+1','(Tues)','','','0','TRUE']]);
  const read=(s:Sheet,r:number,c:number)=>new Engine(book).cell(s.id,s.rows[r].id,s.columns[c].id);
  return {book,ingredients,meals,log,read};
}
it('calculates invented conversion and meal block totals independently of cached Excel values',()=>{
  const {book,ingredients,meals,read}=fixture();
  expect(read(meals,6,4)).toBe(60);
  expect(read(meals,1,5)).toBe(110);
  expect(read(meals,4,5)).toBe(360);
  const table=book.tables.find(t=>t.name==='Ingredients')!;renameColumn(book,table,table.columns[5].id,'Energy density');move(ingredients.columns,5,0);
  expect(read(meals,1,5)).toBe(110);expect(read(meals,4,5)).toBe(360);
  const restored=JSON.parse(JSON.stringify(book)) as Workbook;
  expect(new Engine(restored).cell(meals.id,meals.rows[4].id,meals.columns[5].id)).toBe(360);
});
it('preserves explicit day headers, manual dishes, meal-first lookups and scoped filtered meal dropdowns',()=>{
  const {book,meals,log,read}=fixture();
  expect(read(log,1,4)).toBe(710);
  expect(read(log,1,0)).toBe(45782);expect(read(log,5,0)).toBe(45783);
  log.rows[5].status='hypothetical';expect(read(log,5,0)).toBe(45783);
  book.names.push({id:uid(),name:'MealDD',context:meals.id,original:'=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',formula:compile('=FILTER(Meals[Meal],Meals[isMeal]=TRUE)',book,meals.id,meals.rows[10].id,meals.columns[0].id)});
  book.names.push({id:uid(),name:'MealDD',sheet:log.id,context:log.id,original:'="Local"',formula:{kind:'literal',value:'Local'}});
  const e=new Engine(book);
  expect(flatten(e.evaluate(compile('=MealDD',book,meals.id,meals.rows[10].id,meals.columns[0].id),meals.id,meals.rows[10].id,meals.columns[0].id))).toEqual(['Test lunch','Test dinner']);
  expect(e.evaluate(compile('=MealDD',book,log.id,log.rows[10].id,log.columns[0].id),log.id,log.rows[10].id,log.columns[0].id)).toBe('Local');
  expect(log.cells[key(log.rows[4].id,log.columns[4].id)].value).toBe(500);
});
it('uses elementwise error fallbacks, horizontal filters and Excel literal-versus-reference SUM rules',()=>{
  const {book,ingredients:s}=fixture(),row=s.rows[10].id,col=s.columns[9].id;
  const put=(r:number,c:number,input:string)=>setInput(book,s,s.rows[r].id,s.columns[c].id,input);
  put(10,0,'=1/0');put(11,0,'=1/0');put(10,1,'10');put(11,1,'20');
  const calc=(source:string)=>new Engine(book).evaluate(compile(source,book,s.id,row,col),s.id,row,col);
  expect(flatten(calc('=IFERROR(A11:A12,B11:B12)'))).toEqual([10,20]);
  put(10,2,'TRUE');put(10,3,'FALSE');
  expect(flatten(calc('=FILTER(A1:B1,C11:D11)'))).toEqual(['Ingredient']);
  put(11,2,'FALSE');expect(calc('=FILTER(A1:B1,C11:C12)')).toMatchObject({error:'#VALUE!'});
  expect(calc('=SUM(1,TRUE,"2")')).toBe(4);
  expect(calc('=SUM(C11)')).toBe(0);
  expect(calc('=SUM("not a number")')).toMatchObject({error:'#VALUE!'});
  expect(calc('=COUNT(TRUE,"not a number")')).toBe(1);
});
