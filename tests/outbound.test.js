const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup(){
 const elements={};
 const c=vm.createContext({document:{addEventListener(){},getElementById(id){return elements[id] ||= {value:'',setCustomValidity(v){this.validationMessage=v;}};}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/outbound.js'),'utf8'),c);
 return c;
}
test('product search matches names and codes with category filtering',()=>{
 const c=setup();
 const products=[{product_name:'Curtain Rod',product_code:'CR-01',category_id:'a'},{product_name:'Pipe',product_code:'PP-02',category_id:'b'}];
 assert.equal(c.filterOutboundProducts(products,' curtain ','').length,1);
 assert.equal(c.filterOutboundProducts(products,'cr-01','a').length,1);
 assert.equal(c.filterOutboundProducts(products,'cr-01','b').length,0);
 assert.equal(c.filterOutboundProducts(products,'','').length,2);
});
test('remaining stock preview rejects excess, fractional and negative quantities',()=>{
 const c=setup();
 vm.runInContext("selectedOutboundProduct = {quantity:60,unit_of_measure:'PCS'}",c);
 const input=c.document.getElementById('outbound-quantity');
 input.value='5';c.calculateOutboundTotal();
 assert.match(c.document.getElementById('outbound-remaining').textContent,/Remaining: 55 PCS/);
 assert.equal(c.document.getElementById('outbound-submit').disabled,false);
 for(const value of ['61','1.5','-1','0','']){
  input.value=value;c.calculateOutboundTotal();
  assert.equal(c.document.getElementById('outbound-submit').disabled,true);
 }
 input.value='60';c.calculateOutboundTotal();
 assert.match(c.document.getElementById('outbound-remaining').textContent,/Remaining: 0 PCS/);
});
