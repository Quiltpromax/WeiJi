package com.weiji.privatejournal;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.drawable.ColorDrawable;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.AtomicFile;
import android.util.Base64;
import android.view.View;
import android.view.HapticFeedbackConstants;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** A permission-free, offline host. The WebView can request only the local app origin. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://weiji.local";
    private static final int PICK_IMAGES = 10, EXPORT_BACKUP = 11, IMPORT_BACKUP = 12;
    private static final int MAX_BACKUP = 80 * 1024 * 1024;
    private WebView web;
    private View privacyCover;
    private File imageDir;
    private AtomicFile stateFile;
    private SharedPreferences prefs;
    private final Object dataLock = new Object();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean unlocked, pickerInFlight, needsLock;
    private int imageLimit = 12, failedAttempts;
    private long blockedUntil;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("private-settings", MODE_PRIVATE);
        imageDir = new File(getFilesDir(), "images");
        imageDir.mkdirs();
        stateFile = new AtomicFile(new File(getFilesDir(), "journal.json"));
        unlocked = !hasPin();
        getWindow().setStatusBarColor(Color.rgb(247,248,245));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setSecureFlag();
        FrameLayout frame = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(247,248,245));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSaveFormData(false);
        web.addJavascriptInterface(new LocalBridge(), "WeijiNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"weiji.local".equals(uri.getHost())) return denied();
                String path = uri.getPath();
                try {
                    if (path == null) return denied();
                    if (path.startsWith("/images/")) {
                        if (!unlocked) return denied();
                        String name = path.substring(8);
                        if (!validImageName(name)) return denied();
                        return response("image/jpeg", new FileInputStream(new File(imageDir, name)));
                    }
                    String asset = path.equals("/") ? "index.html" : path.substring(1);
                    if (!(asset.equals("index.html") || asset.equals("style.css") || asset.equals("theme.css") || asset.equals("theme.js") || asset.equals("core.js") || asset.equals("app.js") || asset.matches("covers/[123]\\.svg"))) return denied();
                    String mime = asset.endsWith(".css") ? "text/css" : asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".svg") ? "image/svg+xml" : "text/html";
                    return response(mime, getAssets().open(asset));
                } catch (Exception ignored) { return denied(); }
            }
        });
        frame.addView(web, new FrameLayout.LayoutParams(-1,-1));
        privacyCover = new View(this);
        privacyCover.setBackgroundColor(Color.rgb(247,248,245));
        privacyCover.setVisibility(View.GONE);
        frame.addView(privacyCover, new FrameLayout.LayoutParams(-1,-1));
        setContentView(frame);
        applyNightTheme(getThemeMode());
        web.loadUrl(ORIGIN + "/index.html");
    }

    private String getThemeMode() {
        return getSharedPreferences("weiji-appearance", MODE_PRIVATE).getString("mode", "system");
    }
    private boolean isDarkMode(String mode) {
        if ("dark".equals(mode)) return true;
        if ("light".equals(mode)) return false;
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }
    private void applyNightTheme(String mode) {
        boolean dark = isDarkMode(mode);
        int background = dark ? Color.rgb(21,28,25) : Color.rgb(247,248,245);
        int navigation = dark ? Color.rgb(30,40,34) : Color.WHITE;
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(navigation);
        View decor = getWindow().getDecorView();
        int lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility((decor.getSystemUiVisibility() & ~lightFlags) | (dark ? 0 : lightFlags));
        decor.setBackgroundColor(background);
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        if (web != null) {
            web.setBackgroundColor(background);
            if (Build.VERSION.SDK_INT >= 29) web.getSettings().setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        if (privacyCover != null) privacyCover.setBackgroundColor(background);
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applyNightTheme(getThemeMode());
        if (web != null) web.evaluateJavascript("window.WeijiTheme && window.WeijiTheme.refresh()", null);
    }

    private WebResourceResponse response(String mime, InputStream data) {
        Map<String,String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, data);
    }
    private WebResourceResponse denied() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
    private boolean hasPin() { return prefs.contains("pin-hash"); }
    private void requireUnlock() { if (!unlocked) throw new IllegalStateException("请先解锁应用。"); }
    private boolean validImageName(String name) { return name != null && name.matches("[a-f0-9]{32}\\.jpg"); }
    private JSONObject ok() throws Exception { return new JSONObject().put("ok", true); }
    private String error(Exception e) {
        try { return new JSONObject().put("ok",false).put("error",e.getMessage() == null ? "操作失败，请重试。" : e.getMessage()).toString(); }
        catch (Exception ignored) { return "{\"ok\":false,\"error\":\"操作失败。\"}"; }
    }
    private JSONObject emptyState() throws Exception { return new JSONObject().put("schema",2).put("tags",new JSONArray()).put("activities",new JSONArray()).put("views",new JSONArray()); }
    private JSONObject loadState() throws Exception {
        if (!stateFile.getBaseFile().exists()) return emptyState();
        try (InputStream in = stateFile.openRead()) { return new JSONObject(new String(readLimited(in,MAX_BACKUP),StandardCharsets.UTF_8)); }
    }
    private void storeState(JSONObject state) throws Exception {
        byte[] data = state.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > MAX_BACKUP) throw new IllegalArgumentException("记录数据过大，请整理后重试。");
        FileOutputStream out = null;
        try { out = stateFile.startWrite(); out.write(data); stateFile.finishWrite(out); }
        catch (Exception e) { if (out != null) stateFile.failWrite(out); throw e; }
    }
    private byte[] readLimited(InputStream in, int limit) throws Exception {
        if (in == null) throw new IllegalArgumentException("无法打开所选文件。");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384]; int count;
        while ((count = in.read(buffer)) != -1) {
            if (out.size() + count > limit) throw new IllegalArgumentException("文件超过大小限制（备份 80 MB，图片 20 MB）。");
            out.write(buffer,0,count);
        }
        return out.toByteArray();
    }
    private Set<String> usedImages(JSONObject state) throws Exception {
        Set<String> names = new HashSet<>();
        JSONArray views = state.getJSONArray("views");
        for (int i=0;i<views.length();i++) {
            JSONArray images = views.getJSONObject(i).getJSONArray("images");
            if (images.length()>12) throw new IllegalArgumentException("每条记录最多 12 张截图。");
            for (int j=0;j<images.length();j++) {
                String name = images.getString(j);
                if (!validImageName(name)) throw new IllegalArgumentException("截图文件名无效。");
                names.add(name);
            }
        }
        return names;
    }
    private void cleanupUnusedImages() throws Exception {
        Set<String> used = usedImages(loadState());
        File[] files = imageDir.listFiles();
        if (files != null) for (File file : files) if (validImageName(file.getName()) && !used.contains(file.getName())) file.delete();
    }
    private void callback(String method, JSONObject result) {
        ui.post(() -> { if (!isFinishing()) web.evaluateJavascript("window.JournalApp && window.JournalApp." + method + "(" + result.toString() + ")", null); });
    }
    private void callbackError(String action, Exception error) {
        try { callback("onNativeResult",new JSONObject().put("action",action).put("error",error.getMessage() == null ? "操作失败。" : error.getMessage())); } catch (Exception ignored) {}
    }
    private void setSecureFlag() {
        if (hasPin()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
    private String pinHash(String pin, String salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(),Base64.decode(salt,Base64.NO_WRAP),120000,256);
        try { return Base64.encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(),Base64.NO_WRAP); }
        finally { spec.clearPassword(); }
    }
    private void checkPin(String pin) throws Exception {
        if (SystemClock.elapsedRealtime()<blockedUntil) throw new IllegalArgumentException("尝试次数较多，请 30 秒后重试。");
        if (!hasPin()) return;
        String expected = prefs.getString("pin-hash", "");
        String actual = pinHash(pin,prefs.getString("pin-salt",""));
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),actual.getBytes(StandardCharsets.UTF_8))) {
            if (++failedAttempts>=5) { blockedUntil=SystemClock.elapsedRealtime()+30000;failedAttempts=0; }
            throw new IllegalArgumentException("密码不正确，请再试一次。");
        }
        failedAttempts=0;blockedUntil=0;
    }
    private void picker(Intent intent, int request) {
        ui.post(() -> {
            try { requireUnlock();pickerInFlight=true;startActivityForResult(intent,request); }
            catch (Exception e) { pickerInFlight=false;callbackError("picker",new IllegalArgumentException("无法打开系统文件选择器。")); }
        });
    }

    private final class LocalBridge {
        @JavascriptInterface public String getTheme() { return getThemeMode(); }
        @JavascriptInterface public boolean isSystemDark() { return isDarkMode("system"); }
        @JavascriptInterface public void setTheme(String mode) {
            if (!("system".equals(mode) || "light".equals(mode) || "dark".equals(mode))) return;
            getSharedPreferences("weiji-appearance", MODE_PRIVATE).edit().putString("mode", mode).apply();
            ui.post(() -> applyNightTheme(mode));
        }
        @JavascriptInterface public void haptic() {
            ui.post(() -> {
                if (!isFinishing()) getWindow().getDecorView().performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            });
        }
        @JavascriptInterface public String getStatus() {
            try { return new JSONObject().put("hasPin",hasPin()).put("unlocked",unlocked).toString(); } catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public String unlock(String pin) {
            try { checkPin(pin);unlocked=true;ui.post(()->privacyCover.setVisibility(View.GONE));return ok().toString(); }
            catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public void lock() { if (hasPin()) unlocked=false; }
        @JavascriptInterface public String setPin(String oldPin, String newPin) {
            try {
                requireUnlock();checkPin(oldPin);
                if (!newPin.isEmpty() && !newPin.matches("[0-9]{4,8}")) throw new IllegalArgumentException("密码需要 4–8 位数字。");
                SharedPreferences.Editor edit = prefs.edit();
                if (newPin.isEmpty()) edit.remove("pin-hash").remove("pin-salt");
                else { byte[] random = new byte[24];new SecureRandom().nextBytes(random);String salt=Base64.encodeToString(random,Base64.NO_WRAP);edit.putString("pin-salt",salt).putString("pin-hash",pinHash(newPin,salt)); }
                if (!edit.commit()) throw new IllegalArgumentException("设置保存失败。");
                ui.post(()->setSecureFlag());return ok().toString();
            } catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public String readState() {
            try { requireUnlock();synchronized(dataLock) { return ok().put("state",loadState()).toString(); } }
            catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public String writeState(String json) {
            try {
                requireUnlock();JSONObject state=new JSONObject(json);
                if (state.getInt("schema")!=2) throw new IllegalArgumentException("数据格式无效。");
                state.getJSONArray("tags");state.getJSONArray("activities");usedImages(state);
                synchronized(dataLock) { storeState(state); }
                return ok().toString();
            } catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public void cleanupImages() {
            worker.execute(() -> { try { requireUnlock();synchronized(dataLock) { cleanupUnusedImages(); } } catch (Exception ignored) {} });
        }
        @JavascriptInterface public String pickImages(int limit) {
            try {
                requireUnlock();imageLimit=Math.max(1,Math.min(12,limit));
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/webp"});picker(intent,PICK_IMAGES);
                return ok().toString();
            } catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public String exportBackup() {
            try {
                requireUnlock();Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE,"微记-备份-"+new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.US).format(new java.util.Date())+".json");picker(intent,EXPORT_BACKUP);return ok().toString();
            } catch (Exception e) { return error(e); }
        }
        @JavascriptInterface public String importBackup() {
            try { requireUnlock();picker(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"),IMPORT_BACKUP);return ok().toString(); }
            catch (Exception e) { return error(e); }
        }
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);pickerInFlight=false;
        if (result!=RESULT_OK||data==null) {
            if(request==PICK_IMAGES)try{callback("onImages",new JSONObject().put("images",new JSONArray()));}catch(Exception ignored){}
            return;
        }
        if (request==PICK_IMAGES) {
            final java.util.ArrayList<Uri> uris=new java.util.ArrayList<>();
            ClipData clip=data.getClipData();
            if (clip!=null) for (int i=0;i<Math.min(clip.getItemCount(),imageLimit);i++) uris.add(clip.getItemAt(i).getUri());
            else if (data.getData()!=null) uris.add(data.getData());
            worker.execute(() -> importImages(uris));
        } else if (data.getData()!=null && request==EXPORT_BACKUP) {
            Uri uri=data.getData();worker.execute(() -> exportTo(uri));
        } else if (data.getData()!=null && request==IMPORT_BACKUP) {
            Uri uri=data.getData();worker.execute(() -> readBackup(uri));
        }
    }
    private void importImages(java.util.List<Uri> uris) {
        JSONArray imported=new JSONArray();
        try {
            requireUnlock();
            for (Uri uri : uris) {
                byte[] raw;
                try (InputStream in=getContentResolver().openInputStream(uri)) { raw=readLimited(in,20*1024*1024); }
                BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
                BitmapFactory.decodeByteArray(raw,0,raw.length,bounds);
                if (bounds.outWidth<=0||bounds.outHeight<=0) throw new IllegalArgumentException("所选文件不是有效图片。");
                BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;
                while (Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>2400) options.inSampleSize*=2;
                Bitmap bitmap=BitmapFactory.decodeByteArray(raw,0,raw.length,options);
                if (bitmap==null) throw new IllegalArgumentException("无法读取图片。");
                Matrix orientation=new Matrix();
                try(InputStream metadata=new ByteArrayInputStream(raw)){
                    int value=new ExifInterface(metadata).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);
                    if(value==ExifInterface.ORIENTATION_ROTATE_90)orientation.postRotate(90);
                    else if(value==ExifInterface.ORIENTATION_ROTATE_180)orientation.postRotate(180);
                    else if(value==ExifInterface.ORIENTATION_ROTATE_270)orientation.postRotate(270);
                    else if(value==ExifInterface.ORIENTATION_FLIP_HORIZONTAL)orientation.postScale(-1,1);
                    else if(value==ExifInterface.ORIENTATION_FLIP_VERTICAL)orientation.postScale(1,-1);
                    else if(value==ExifInterface.ORIENTATION_TRANSPOSE){orientation.postRotate(90);orientation.postScale(-1,1);}
                    else if(value==ExifInterface.ORIENTATION_TRANSVERSE){orientation.postRotate(270);orientation.postScale(-1,1);}
                }catch(Exception ignored){}
                if(!orientation.isIdentity()){
                    Bitmap oriented=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),orientation,true);
                    if(oriented!=bitmap){bitmap.recycle();bitmap=oriented;}
                }
                float scale=Math.min(1f,1600f/Math.max(bitmap.getWidth(),bitmap.getHeight()));
                Bitmap output=Bitmap.createBitmap(Math.max(1,Math.round(bitmap.getWidth()*scale)),Math.max(1,Math.round(bitmap.getHeight()*scale)),Bitmap.Config.ARGB_8888);
                Canvas canvas=new Canvas(output);canvas.drawColor(Color.WHITE);
                canvas.drawBitmap(bitmap,null,new android.graphics.Rect(0,0,output.getWidth(),output.getHeight()),new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG));
                String name=UUID.randomUUID().toString().replace("-","")+".jpg";
                File file=new File(imageDir,name);
                try (OutputStream stream=new FileOutputStream(file)) { if (!output.compress(Bitmap.CompressFormat.JPEG,88,stream)) throw new IllegalArgumentException("图片保存失败。"); }
                bitmap.recycle();output.recycle();imported.put(name);
            }
            callback("onImages",new JSONObject().put("images",imported));
        } catch (Exception e) {
            for (int i=0;i<imported.length();i++)new File(imageDir,imported.optString(i)).delete();
            try { callback("onImages",new JSONObject().put("error",e.getMessage()==null?"图片导入失败。":e.getMessage())); } catch (Exception ignored) {}
        }
    }
    private void exportTo(Uri uri) {
        try {
            requireUnlock();JSONObject backup;
            synchronized(dataLock) {
                JSONObject state=loadState(),images=new JSONObject();
                int estimated=state.toString().getBytes(StandardCharsets.UTF_8).length;
                for (String name : usedImages(state)) {
                    File file=new File(imageDir,name);
                    estimated+=file.length()*4/3+200;
                    if (estimated>MAX_BACKUP) throw new IllegalArgumentException("备份超过 80 MB，请减少截图后重试。");
                    try (InputStream in=new FileInputStream(file)) { images.put(name,Base64.encodeToString(readLimited(in,20*1024*1024),Base64.NO_WRAP)); }
                }
                backup=new JSONObject().put("format","weiji-backup").put("version",1).put("exportedAt",new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX",java.util.Locale.US).format(new java.util.Date())).put("state",state).put("images",images);
            }
            byte[] bytes=backup.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length>MAX_BACKUP) throw new IllegalArgumentException("备份超过 80 MB。");
            try (OutputStream out=getContentResolver().openOutputStream(uri,"wt")) { if (out==null)throw new IllegalArgumentException("无法保存到所选位置。");out.write(bytes); }
            callback("onNativeResult",new JSONObject().put("action","export"));
        } catch (Exception e) { callbackError("export",e); }
    }
    private void readBackup(Uri uri) {
        try {
            requireUnlock();JSONObject backup;
            try (InputStream in=getContentResolver().openInputStream(uri)) { backup=new JSONObject(new String(readLimited(in,MAX_BACKUP),StandardCharsets.UTF_8)); }
            if (!"weiji-backup".equals(backup.optString("format"))||backup.optInt("version")!=1) throw new IllegalArgumentException("请选择微记导出的备份文件。");
            JSONObject candidate=backup.getJSONObject("state");
            ui.post(() -> web.evaluateJavascript("JSON.stringify(window.JournalApp.validateBackup("+JSONObject.quote(candidate.toString())+"))",value -> {
                try {
                    String decoded=(String)new org.json.JSONTokener(value).nextValue();
                    JSONObject validated=new JSONObject(decoded);
                    if (!validated.optBoolean("ok"))throw new IllegalArgumentException(validated.optString("error","备份格式无效。"));
                    JSONObject clean=validated.getJSONObject("state");worker.execute(()->commitBackup(backup,clean));
                } catch (Exception e) { callbackError("import",new IllegalArgumentException("备份验证失败，原记录已保留。")); }
            }));
        } catch (Exception e) { callbackError("import",new IllegalArgumentException("备份读取失败或格式错误，原记录已保留。")); }
    }
    private void commitBackup(JSONObject backup,JSONObject state) {
        java.util.ArrayList<File> newFiles=new java.util.ArrayList<>();
        File stage=new File(getCacheDir(),"restore-"+UUID.randomUUID());
        try {
            requireUnlock();stage.mkdirs();JSONObject imageData=backup.optJSONObject("images");
            Map<String,String> mapping=new HashMap<>();
            for (String name : usedImages(state)) {
                if (imageData==null||!imageData.has(name)) throw new IllegalArgumentException("备份缺少截图，原记录已保留。");
                byte[] bytes=Base64.decode(imageData.getString(name),Base64.DEFAULT);
                if (bytes.length>20*1024*1024)throw new IllegalArgumentException("截图数据过大。");
                BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
                if (bounds.outWidth<=0||bounds.outHeight<=0||bounds.outWidth>1600||bounds.outHeight>1600)throw new IllegalArgumentException("备份截图格式无效。");
                String fresh=UUID.randomUUID().toString().replace("-","")+".jpg";
                File file=new File(stage,fresh);try(OutputStream out=new FileOutputStream(file)){out.write(bytes);}mapping.put(name,fresh);
            }
            JSONArray views=state.getJSONArray("views");
            for(int i=0;i<views.length();i++){JSONArray images=views.getJSONObject(i).getJSONArray("images");for(int j=0;j<images.length();j++)images.put(j,mapping.get(images.getString(j)));}
            synchronized(dataLock) {
                for (String fresh : mapping.values()) {
                    File moved=new File(imageDir,fresh);
                    if (!new File(stage,fresh).renameTo(moved))throw new IllegalArgumentException("恢复截图失败，原记录已保留。");
                    newFiles.add(moved);
                }
                storeState(state);newFiles.clear();
                cleanupUnusedImages();
            }
            callback("onNativeResult",new JSONObject().put("action","import"));
        } catch(Exception e){for(File file:newFiles)file.delete();callbackError("import",e);}
        finally {File[] files=stage.listFiles();if(files!=null)for(File file:files)file.delete();stage.delete();}
    }
    @Override protected void onPause() {
        if (hasPin()&&!pickerInFlight) {unlocked=false;needsLock=true;privacyCover.setVisibility(View.VISIBLE);}
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (needsLock&&web!=null) {needsLock=false;web.evaluateJavascript("window.JournalApp && window.JournalApp.lock()",value->privacyCover.setVisibility(View.GONE));}
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.JournalApp ? window.JournalApp.back() : false",result->{if(!"true".equals(result))finish();});
    }
    @Override protected void onDestroy() {worker.shutdown();web.removeJavascriptInterface("WeijiNative");web.destroy();super.onDestroy();}
}
