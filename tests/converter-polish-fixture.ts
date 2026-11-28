import {blankSheet,setInput,uid,type Workbook} from '../src/model';
import {captureData,newNutritionBatch,nutrients} from '../src/food-capture';
import {masterLogging} from '../src/day-logging';

export function syntheticConverterBook(linkedOnly=false):Workbook{
  const master=blankSheet('Synthetic Master',5,14),ingredients=blankSheet('Synthetic Ingredients',3,12);
  const names=['Date','Weight','isDay','Food','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Amount (g)','Amount','Unit','Exercise'];
  const sourceNames=['Ingredients','Calories','Protein (g)','Fat (g)','Carbs (g)','Sugar (g)','Sodium (mg)','Serving (g)','Conversion Amount','Conversion Unit','Type'];
  const table=(sheet:typeof master,name:string,columns:string[],rows:number[])=>({id:uid(),name,sheet:sheet.id,header:sheet.rows[0].id,rows:rows.map(index=>sheet.rows[index].id),columns:columns.map((name,index)=>({id:uid(),name,column:sheet.columns[index].id}))});
  const log=table(master,'Master',names,[1,2]),source=table(ingredients,'Ingredients',sourceNames,[1]);
  const book:Workbook={schema:1,id:uid(),title:'Synthetic converter work in progress',revision:0,names:[],pickerSources:{},sheets:[master,ingredients],tables:[log,source]};
  for(const item of book.tables)for(const column of item.columns)setInput(book,book.sheets.find(sheet=>sheet.id===item.sheet)!,item.header,column.column,column.name);
  const put=(sheet:typeof master,row:number,column:number,value:string)=>setInput(book,sheet,sheet.rows[row].id,sheet.columns[column].id,value);
  put(master,1,0,'45000');put(master,1,1,'x');put(master,1,2,'TRUE');
  put(master,2,3,"'Synthetic rice");put(master,2,10,'30');
  master.dayLogging=masterLogging(book,master).config;
  const fields=['food',...nutrients,'weight','amount','unit'] as const;
  master.mealLog={table:log.id,fields:Object.fromEntries(fields.map((field,index)=>[field,log.columns[index+3].id])),ingredients:{table:source.id,fields:Object.fromEntries(fields.map((field,index)=>[field,source.columns[index].id]))}};
  put(ingredients,1,0,"'Synthetic mochi");put(ingredients,1,7,'25');put(ingredients,1,8,'1');put(ingredients,1,9,"'each");
  if(linkedOnly)for(let index=0;index<nutrients.length;index++)put(ingredients,1,index+1,'0');
  ingredients.validations.push({id:uid(),sheet:ingredients.id,rows:[ingredients.rows[1].id],columns:[ingredients.columns[10].id],source:'',values:['Packaged','Homemade']});
  const data=captureData(book);data.ingredientMappings=[{table:source.id,fields:{...master.mealLog.ingredients!.fields,type:source.columns[10].id}}];
  data.foods.push({id:uid(),date:45000,mode:'single',values:{food:'Synthetic soup (vegetables)',weight:'47'},parts:[],restaurantText:'Synthetic cafe',photos:[],loggingTarget:{sheet:master.id,table:log.id}},
    {id:uid(),date:45000,mode:'single',values:{food:'Synthetic mochi',amount:'2',unit:'each'},parts:[],photos:[],loggingTarget:{sheet:master.id,table:log.id},ingredient:{table:source.id,row:ingredients.rows[1].id}});
  data.builder=newNutritionBatch(book,[45000],'Synthetic request');data.builder.generated=true;
  if(linkedOnly)for(const item of data.builder.items)item.selected=false;
  return book;
}
