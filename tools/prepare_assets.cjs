/* Keep the APK compatible with Android 8's JavaScript engine. */
const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
const target=process.argv[2];
if(!target)throw Error('Expected the build assets directory.');
for(const file of ['core.js','app.js','theme.js']){
  const source=path.join(target,file);
  const result=esbuild.transformSync(fs.readFileSync(source,'utf8'),{
    target:'chrome61',charset:'utf8',minify:false,legalComments:'inline'
  });
  fs.writeFileSync(source,result.code,'utf8');
}
