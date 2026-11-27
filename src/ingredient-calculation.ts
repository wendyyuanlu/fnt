import type {Ast} from './formula';
import {nutrients,type Nutrient} from './food-capture';
import type {MealField} from './meal-log';
import {fault} from './model';

interface CalculationAddress{sheet:string;row:string;fields:ReadonlyMap<string,string>}
export function ingredientConsumptionCalculations(target:CalculationAddress,source:CalculationAddress):{weight:Ast;nutrition:Map<Nutrient,Ast>}{
  const ref=(address:CalculationAddress,column:string):Ast=>({kind:'ref',sheet:address.sheet,row:address.row,column,absRow:true,absCol:true});
  const literal=(value:string|number):Ast=>({kind:'literal',value});
  const binary=(op:string,left:Ast,right:Ast):Ast=>({kind:'binary',op,left,right});
  const call=(name:string,...args:Ast[]):Ast=>({kind:'call',name,args});
  const choose=(test:Ast,yes:Ast,no:Ast)=>call('IF',test,yes,no);
  const positive=(value:Ast)=>binary('>',value,literal(0));
  const present=(value:Ast)=>binary('<>',value,literal(''));
  const field=(address:CalculationAddress,name:MealField,empty:string|number='')=>{
    const column=address.fields.get(name);return column?ref(address,column):literal(empty);
  };
  const weight=field(target,'weight'),amount=field(target,'amount'),unit=field(target,'unit');
  const referenceWeight=field(source,'weight',0),referenceAmount=field(source,'amount',0),referenceUnit=field(source,'unit');
  const unitFactor=(from:Ast,to:Ast)=>call('UNITFACTOR',from,to);
  const ratio=(numerator:Ast,denominator:Ast)=>binary('/',numerator,denominator);
  const product=(left:Ast,right:Ast)=>binary('*',left,right);
  const amountRatio=ratio(product(amount,unitFactor(unit,referenceUnit)),referenceAmount);
  const amountGrams=choose(
    call('AND',positive(referenceWeight),positive(referenceAmount),present(referenceUnit)),
    product(amountRatio,referenceWeight),
    call('IFERROR',product(amount,unitFactor(unit,literal('g'))),literal('')),
  );
  const factor=choose(present(weight),
    choose(positive(referenceWeight),ratio(weight,referenceWeight),ratio(product(weight,unitFactor(literal('g'),referenceUnit)),referenceAmount)),
    choose(positive(referenceAmount),amountRatio,ratio(product(amount,unitFactor(unit,literal('g'))),referenceWeight)),
  );
  const hasQuantity=call('OR',present(weight),present(amount));
  const unavailable:Ast={kind:'error',value:fault('#VALUE!','Enter known nutrition and a compatible consumed portion before recalculating.')};
  const nutrition=new Map(nutrients.map(nutrient=>{
    const column=source.fields.get(nutrient),value:Ast=column?ref(source,column):{kind:'error',value:fault('#REF!',`Restore the Ingredient ${nutrient} mapping before recalculating.`)};
    return[nutrient,choose(call('AND',hasQuantity,present(value)),product(value,factor),unavailable)] as const;
  }));
  return{weight:choose(present(amount),amountGrams,literal('')),nutrition};
}
