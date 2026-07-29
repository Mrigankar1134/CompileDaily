#!/usr/bin/env python3
import argparse, hashlib, os, struct, zlib, zipfile, subprocess, shutil
from pathlib import Path

U32=lambda x: struct.pack('<I', x & 0xffffffff)
U16=lambda x: struct.pack('<H', x & 0xffff)
NO_INDEX=0xffffffff
# Resource ID for @mipmap/ic_launcher: package 0x7f, type 1 (the only type,
# "mipmap"), entry 0 (the only entry, "ic_launcher"). Must match ArscBuilder.
ICON_RES_ID=0x7f010000

def res_string_pool(strings):
    """A standalone ResStringPool chunk (type 0x0001), UTF-8 encoded, shared by
    both the AndroidManifest (AXML) and resources.arsc (ARSC) binary formats."""
    raw=bytearray(); offsets=[]
    for s in strings:
        offsets.append(len(raw)); b=s.encode('utf-8')
        assert len(s)<128 and len(b)<128
        raw+=bytes([len(s),len(b)])+b+b'\0'
    while len(raw)%4: raw.append(0)
    header_size=28; strings_start=header_size+4*len(strings); size=strings_start+len(raw)
    out=bytearray(struct.pack('<HHI',0x0001,header_size,size))
    out+=struct.pack('<IIIII',len(strings),0,0x100,strings_start,0)
    for o in offsets: out+=U32(o)
    out+=raw
    return bytes(out)

def align(data: bytearray, n=4):
    while len(data)%n: data.append(0)

def uleb(n:int)->bytes:
    out=bytearray()
    while True:
        b=n&0x7f; n>>=7
        if n: out.append(b|0x80)
        else: out.append(b); return bytes(out)

def mutf8(s:str)->bytes:
    # All strings used here are ASCII; this also handles ordinary UTF-8 BMP text.
    b=s.encode('utf-8')
    return uleb(len(s.encode('utf-16-le'))//2)+b+b'\0'

class DexBuilder:
    def __init__(self):
        self.class_desc='Lcom/moushana/javaprep/MainActivity;'
        self.strings=set([
            '<init>','L','V','VL','VZ','Z',
            'Landroid/app/Activity;','Landroid/content/Context;','Landroid/os/Bundle;',
            'Landroid/view/View;','Landroid/webkit/WebSettings;','Landroid/webkit/WebView;',
            self.class_desc,'Ljava/lang/String;',
            'file:///android_asset/index.html','getSettings','loadUrl','onCreate',
            'setContentView','setJavaScriptEnabled','setDomStorageEnabled'
        ])
        self.strings=sorted(self.strings)
        self.sidx={s:i for i,s in enumerate(self.strings)}
        descriptors=[s for s in self.strings if s in {
            'V','Z','Landroid/app/Activity;','Landroid/content/Context;','Landroid/os/Bundle;',
            'Landroid/view/View;','Landroid/webkit/WebSettings;','Landroid/webkit/WebView;',
            self.class_desc,'Ljava/lang/String;'}]
        self.types=sorted(descriptors,key=lambda s:self.sidx[s])
        self.tidx={s:i for i,s in enumerate(self.types)}
        proto_specs=[
            ('V','V',()),
            ('VL','V',('Landroid/os/Bundle;',)),
            ('VL','V',('Landroid/content/Context;',)),
            ('L','Landroid/webkit/WebSettings;',()),
            ('VZ','V',('Z',)),
            ('VL','V',('Ljava/lang/String;',)),
            ('VL','V',('Landroid/view/View;',)),
        ]
        # Unique and sorted: return type major, then argument type list lexicographic.
        uniq=[]
        for p in proto_specs:
            if p not in uniq: uniq.append(p)
        self.protos=sorted(uniq,key=lambda p:(self.tidx[p[1]],tuple(self.tidx[x] for x in p[2])))
        self.pidx={(r,args):i for i,(short,r,args) in enumerate(self.protos)}
        methods=[
            ('Landroid/app/Activity;','<init>','V',()),
            ('Landroid/app/Activity;','onCreate','V',('Landroid/os/Bundle;',)),
            ('Landroid/app/Activity;','setContentView','V',('Landroid/view/View;',)),
            ('Landroid/webkit/WebSettings;','setDomStorageEnabled','V',('Z',)),
            ('Landroid/webkit/WebSettings;','setJavaScriptEnabled','V',('Z',)),
            ('Landroid/webkit/WebView;','<init>','V',('Landroid/content/Context;',)),
            ('Landroid/webkit/WebView;','getSettings','Landroid/webkit/WebSettings;',()),
            ('Landroid/webkit/WebView;','loadUrl','V',('Ljava/lang/String;',)),
            (self.class_desc,'<init>','V',()),
            (self.class_desc,'onCreate','V',('Landroid/os/Bundle;',)),
        ]
        self.methods=sorted(methods,key=lambda m:(self.tidx[m[0]],self.sidx[m[1]],self.pidx[(m[2],m[3])]))
        self.midx={(c,n,r,a):i for i,(c,n,r,a) in enumerate(self.methods)}

    def invoke35c(self,opcode,regs,method_idx):
        assert len(regs)<=5 and all(0<=r<16 for r in regs)
        A=len(regs); rr=regs+[0]*(5-len(regs)); C,D,E,F,G=rr
        first=opcode | (G<<8) | (A<<12)
        third=C | (D<<4) | (E<<8) | (F<<12)
        return [first,method_idx,third]

    def code_ctor(self):
        act_init=self.midx[('Landroid/app/Activity;','<init>','V',())]
        ins=self.invoke35c(0x70,[0],act_init)+[0x000e]
        return self.code_item(1,1,1,ins)

    def code_oncreate(self):
        act_on=self.midx[('Landroid/app/Activity;','onCreate','V',('Landroid/os/Bundle;',))]
        wv_ctor=self.midx[('Landroid/webkit/WebView;','<init>','V',('Landroid/content/Context;',))]
        get_settings=self.midx[('Landroid/webkit/WebView;','getSettings','Landroid/webkit/WebSettings;',())]
        js=self.midx[('Landroid/webkit/WebSettings;','setJavaScriptEnabled','V',('Z',))]
        dom=self.midx[('Landroid/webkit/WebSettings;','setDomStorageEnabled','V',('Z',))]
        load=self.midx[('Landroid/webkit/WebView;','loadUrl','V',('Ljava/lang/String;',))]
        setcv=self.midx[('Landroid/app/Activity;','setContentView','V',('Landroid/view/View;',))]
        webview_t=self.tidx['Landroid/webkit/WebView;']
        url_s=self.sidx['file:///android_asset/index.html']
        ins=[]
        ins += self.invoke35c(0x6f,[2,3],act_on)               # invoke-super
        ins += [0x0022,webview_t]                              # new-instance v0
        ins += self.invoke35c(0x70,[0,2],wv_ctor)              # ctor(WebView, context)
        ins += self.invoke35c(0x6e,[0],get_settings)           # getSettings
        ins += [0x010c]                                        # move-result-object v1
        ins += [0x1312]                                        # const/4 v3, #1
        ins += self.invoke35c(0x6e,[1,3],js)                   # JS enabled
        ins += self.invoke35c(0x6e,[1,3],dom)                  # DOM storage enabled
        ins += [0x011a,url_s]                                  # const-string v1, url
        ins += self.invoke35c(0x6e,[0,1],load)                 # loadUrl
        ins += self.invoke35c(0x6e,[2,0],setcv)                # setContentView
        ins += [0x000e]
        return self.code_item(4,2,2,ins)

    @staticmethod
    def code_item(registers,ins_size,outs_size,insns):
        b=bytearray()
        b += struct.pack('<HHHHII',registers,ins_size,outs_size,0,0,len(insns))
        for x in insns: b+=U16(x)
        return bytes(b)

    def build(self):
        sc=len(self.strings); tc=len(self.types); pc=len(self.protos); mc=len(self.methods)
        header_size=0x70
        string_ids_off=header_size
        type_ids_off=string_ids_off+4*sc
        proto_ids_off=type_ids_off+4*tc
        method_ids_off=proto_ids_off+12*pc
        class_defs_off=method_ids_off+8*mc
        data_off=class_defs_off+32
        assert data_off%4==0
        data=bytearray()
        string_offsets=[]
        for s in self.strings:
            string_offsets.append(data_off+len(data)); data+=mutf8(s)
        first_string_data=string_offsets[0]
        align(data,4)
        # De-duplicate parameter type lists.
        param_lists=[]
        for _,_,args in self.protos:
            if args and args not in param_lists: param_lists.append(args)
        param_lists=sorted(param_lists,key=lambda a:tuple(self.tidx[x] for x in a))
        param_off={}
        first_type_list=0
        for args in param_lists:
            align(data,4)
            off=data_off+len(data)
            if not first_type_list:first_type_list=off
            param_off[args]=off
            data+=U32(len(args))
            for a in args:data+=U16(self.tidx[a])
            align(data,4)
        # Code items.
        align(data,4); ctor_off=data_off+len(data); first_code=ctor_off
        data+=self.code_ctor(); align(data,4)
        oncreate_off=data_off+len(data); data+=self.code_oncreate(); align(data,4)
        # Class data item.
        class_data_off=data_off+len(data)
        ctor_idx=self.midx[(self.class_desc,'<init>','V',())]
        on_idx=self.midx[(self.class_desc,'onCreate','V',('Landroid/os/Bundle;',))]
        class_data=bytearray(uleb(0)+uleb(0)+uleb(1)+uleb(1))
        class_data+=uleb(ctor_idx)+uleb(0x10001)+uleb(ctor_off)
        class_data+=uleb(on_idx)+uleb(0x0001)+uleb(oncreate_off)
        data+=class_data
        align(data,4)
        # map_list at end
        map_off=data_off+len(data)
        map_entries=[
            (0x0000,1,0),
            (0x0001,sc,string_ids_off),
            (0x0002,tc,type_ids_off),
            (0x0003,pc,proto_ids_off),
            (0x0005,mc,method_ids_off),
            (0x0006,1,class_defs_off),
            (0x2002,sc,first_string_data),
        ]
        if param_lists: map_entries.append((0x1001,len(param_lists),first_type_list))
        map_entries += [(0x2001,2,first_code),(0x2000,1,class_data_off),(0x1000,1,map_off)]
        map_entries=sorted(map_entries,key=lambda e:e[2])
        data+=U32(len(map_entries))
        for typ,size,off in map_entries:data+=struct.pack('<HHII',typ,0,size,off)
        file_size=data_off+len(data); data_size=len(data)
        out=bytearray(b'\0'*header_size)
        # IDs
        for off in string_offsets: out+=U32(off)
        for t in self.types: out+=U32(self.sidx[t])
        for short,r,args in self.protos: out+=struct.pack('<III',self.sidx[short],self.tidx[r],param_off.get(args,0))
        for c,n,r,args in self.methods: out+=struct.pack('<HHI',self.tidx[c],self.pidx[(r,args)],self.sidx[n])
        # class_def
        out+=struct.pack('<IIIIIIII',self.tidx[self.class_desc],0x1,self.tidx['Landroid/app/Activity;'],0,NO_INDEX,0,class_data_off,0)
        assert len(out)==data_off
        out+=data
        # Header
        out[0:8]=b'dex\n035\0'
        struct.pack_into('<I',out,32,file_size)
        struct.pack_into('<I',out,36,header_size)
        struct.pack_into('<I',out,40,0x12345678)
        struct.pack_into('<II',out,44,0,0)
        struct.pack_into('<I',out,52,map_off)
        struct.pack_into('<II',out,56,sc,string_ids_off)
        struct.pack_into('<II',out,64,tc,type_ids_off)
        struct.pack_into('<II',out,72,pc,proto_ids_off)
        struct.pack_into('<II',out,80,0,0)
        struct.pack_into('<II',out,88,mc,method_ids_off)
        struct.pack_into('<II',out,96,1,class_defs_off)
        struct.pack_into('<II',out,104,data_size,data_off)
        sig=hashlib.sha1(out[32:]).digest(); out[12:32]=sig
        checksum=zlib.adler32(out[12:])&0xffffffff; struct.pack_into('<I',out,8,checksum)
        return bytes(out)

# Android binary XML builder.
class AxmlBuilder:
    TYPE_STRING=0x03; TYPE_REFERENCE=0x01; TYPE_INT_DEC=0x10; TYPE_INT_BOOLEAN=0x12
    ANDROID_URI='http://schemas.android.com/apk/res/android'
    def __init__(self):
        self.strings=[
            'android',self.ANDROID_URI,'manifest','package','com.moushana.javaprep',
            'versionCode','versionName','1.0','uses-sdk','minSdkVersion','targetSdkVersion',
            'uses-permission','android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE',
            'application','label','Compile Daily','allowBackup','supportsRtl','theme','icon',
            'activity','name','com.moushana.javaprep.MainActivity','screenOrientation','exported',
            'intent-filter','action','android.intent.action.MAIN','category','android.intent.category.LAUNCHER'
        ]
        self.idx={s:i for i,s in enumerate(self.strings)}
        self.resids={
            'versionCode':0x0101021b,'versionName':0x0101021c,'minSdkVersion':0x0101020c,
            'targetSdkVersion':0x01010270,'label':0x01010001,'allowBackup':0x01010280,
            'supportsRtl':0x010103af,'theme':0x01010000,'name':0x01010003,
            'screenOrientation':0x0101001e,'exported':0x01010010,'icon':0x01010002
        }
    def string_pool(self):
        raw=bytearray(); offsets=[]
        for s in self.strings:
            offsets.append(len(raw)); b=s.encode('utf-8');
            assert len(s)<128 and len(b)<128
            raw+=bytes([len(s),len(b)])+b+b'\0'
        while len(raw)%4:raw.append(0)
        header_size=28; strings_start=header_size+4*len(self.strings); size=strings_start+len(raw)
        b=bytearray(struct.pack('<HHI',0x0001,header_size,size))
        b+=struct.pack('<IIIII',len(self.strings),0,0x100,strings_start,0)
        for o in offsets:b+=U32(o)
        b+=raw
        return bytes(b)
    def resource_map(self):
        vals=[self.resids.get(s,0) for s in self.strings]
        return struct.pack('<HHI',0x0180,8,8+4*len(vals))+b''.join(U32(v) for v in vals)
    def ns(self,start=True,line=1):
        return struct.pack('<HHIIII',0x0100 if start else 0x0101,16,24,line,NO_INDEX,self.idx['android'])+U32(self.idx[self.ANDROID_URI])
    def attr(self,name,value,kind='string',android=True):
        ns=self.idx[self.ANDROID_URI] if android else NO_INDEX
        n=self.idx[name]
        if kind=='string': raw=self.idx[value]; dtype=self.TYPE_STRING; data=raw
        elif kind=='int': raw=NO_INDEX; dtype=self.TYPE_INT_DEC; data=int(value)
        elif kind=='bool': raw=NO_INDEX; dtype=self.TYPE_INT_BOOLEAN; data=0xffffffff if value else 0
        elif kind=='ref': raw=NO_INDEX; dtype=self.TYPE_REFERENCE; data=int(value)
        else: raise ValueError(kind)
        return struct.pack('<IIIHBBI',ns,n,raw,8,0,dtype,data&0xffffffff)
    def start(self,tag,attrs,line=1):
        ab=b''.join(attrs); size=36+len(ab)
        return struct.pack('<HHIII',0x0102,16,size,line,NO_INDEX)+struct.pack('<IIHHHHHH',NO_INDEX,self.idx[tag],20,20,len(attrs),0,0,0)+ab
    def end(self,tag,line=1):
        return struct.pack('<HHIIIII',0x0103,16,24,line,NO_INDEX,NO_INDEX,self.idx[tag])
    def build(self):
        chunks=bytearray()
        chunks+=self.string_pool(); chunks+=self.resource_map(); chunks+=self.ns(True)
        chunks+=self.start('manifest',[
            self.attr('package','com.moushana.javaprep','string',False),
            self.attr('versionCode',1,'int'),self.attr('versionName','1.0','string')])
        chunks+=self.start('uses-sdk',[self.attr('minSdkVersion',23,'int'),self.attr('targetSdkVersion',28,'int')]);chunks+=self.end('uses-sdk')
        chunks+=self.start('uses-permission',[self.attr('name','android.permission.INTERNET','string')]);chunks+=self.end('uses-permission')
        chunks+=self.start('uses-permission',[self.attr('name','android.permission.ACCESS_NETWORK_STATE','string')]);chunks+=self.end('uses-permission')
        chunks+=self.start('application',[
            self.attr('label','Compile Daily','string'),self.attr('allowBackup',False,'bool'),
            self.attr('supportsRtl',True,'bool'),self.attr('theme',0x01030241,'ref'),
            self.attr('icon',ICON_RES_ID,'ref')])
        chunks+=self.start('activity',[
            self.attr('name','com.moushana.javaprep.MainActivity','string'),
            self.attr('screenOrientation',1,'int'),self.attr('exported',True,'bool')])
        chunks+=self.start('intent-filter',[])
        chunks+=self.start('action',[self.attr('name','android.intent.action.MAIN','string')]);chunks+=self.end('action')
        chunks+=self.start('category',[self.attr('name','android.intent.category.LAUNCHER','string')]);chunks+=self.end('category')
        chunks+=self.end('intent-filter');chunks+=self.end('activity');chunks+=self.end('application');chunks+=self.end('manifest');chunks+=self.ns(False)
        return struct.pack('<HHI',0x0003,8,8+len(chunks))+chunks

# Minimal Android resource table (resources.arsc): one package, one type
# ("mipmap"), one entry ("ic_launcher") pointing at a single file-based PNG
# resource. This is just enough for AndroidManifest's android:icon="@mipmap/
# ic_launcher" reference to resolve — no density variants, no other resource
# types. Deliberately using the "classic" (pre-typeIdOffset) struct layouts
# for maximum compatibility down to the app's minSdkVersion.
class ArscBuilder:
    def __init__(self, package_name, icon_apk_path):
        self.package_name=package_name
        self.icon_apk_path=icon_apk_path  # e.g. 'res/mipmap/ic_launcher.png'

    def build(self):
        global_pool=res_string_pool([self.icon_apk_path])
        type_strings=res_string_pool(['mipmap'])
        key_strings=res_string_pool(['ic_launcher'])

        # ResTable_typeSpec: type id 1, 1 entry, no flags.
        typespec=struct.pack('<HHI',0x0202,16,20)+struct.pack('<BBHI',1,0,0,1)+U32(0)

        # ResTable_type: type id 1, default/"any" config (classic 28-byte config,
        # all zero = matches any device configuration), 1 entry.
        entries_start=48+4*1  # fixed header (48) + one 4-byte entry-offset slot
        entry=struct.pack('<HHI',8,0,0)+struct.pack('<HBBI',8,0,0x03,0)  # simple entry, key#0, TYPE_STRING -> global string #0
        type_size=entries_start+len(entry)
        config=U32(28)+b'\0'*24
        type_chunk=struct.pack('<HHI',0x0201,48,type_size)
        type_chunk+=struct.pack('<BBHII',1,0,0,1,entries_start)
        type_chunk+=config
        type_chunk+=U32(0)   # entries-offset array: entry #0 at offset 0
        type_chunk+=entry
        assert len(type_chunk)==type_size

        name_utf16=self.package_name.encode('utf-16-le')
        name_field=name_utf16+b'\0'*(256-len(name_utf16))
        pkg_fixed_size=284
        pkg_body_after_fixed=type_strings+key_strings+typespec+type_chunk
        pkg_size=pkg_fixed_size+len(pkg_body_after_fixed)
        pkg=struct.pack('<HHI',0x0200,pkg_fixed_size,pkg_size)
        pkg+=U32(0x7f)+name_field
        pkg+=U32(pkg_fixed_size)          # typeStrings offset (from package chunk start)
        pkg+=U32(1)                       # lastPublicType
        pkg+=U32(pkg_fixed_size+len(type_strings))  # keyStrings offset
        pkg+=U32(1)                       # lastPublicKey
        pkg+=pkg_body_after_fixed
        assert len(pkg)==pkg_size

        total=12+len(global_pool)+len(pkg)
        out=struct.pack('<HHI',0x0002,12,total)+U32(1)+global_pool+pkg
        assert len(out)==total
        return bytes(out)

def verify_arsc(a, expect_path):
    typ,hs,size=struct.unpack_from('<HHI',a,0); assert (typ,hs,size)==(0x0002,12,len(a))
    pkg_count=struct.unpack_from('<I',a,8)[0]; assert pkg_count==1
    gtyp,ghs,gsize=struct.unpack_from('<HHI',a,12)
    assert gtyp==0x0001 and ghs==28
    pkg_off=12+gsize
    ptyp,phs,psize=struct.unpack_from('<HHI',a,pkg_off); assert (ptyp,phs)==(0x0200,284)
    pkg_id=struct.unpack_from('<I',a,pkg_off+8)[0]; assert pkg_id==0x7f
    type_strings_off,last_type,key_strings_off,last_key=struct.unpack_from('<IIII',a,pkg_off+8+4+256)
    assert last_type==1 and last_key==1
    tt,_,_=struct.unpack_from('<HHI',a,pkg_off+type_strings_off); assert tt==0x0001
    kt,_,_=struct.unpack_from('<HHI',a,pkg_off+key_strings_off); assert kt==0x0001
    assert pkg_off+psize==len(a)
    # The global string pool's one entry must equal the expected APK-relative icon path.
    scount=struct.unpack_from('<I',a,12+8)[0]; assert scount==1
    sstart=struct.unpack_from('<I',a,12+8+12)[0]
    soff=struct.unpack_from('<I',a,12+28)[0]
    base=12+sstart+soff
    slen=a[base]; b=a[base+2:base+2+slen].decode('utf-8')
    assert b==expect_path, (b,expect_path)

def verify_dex(d):
    assert d[:8]==b'dex\n035\0'
    assert struct.unpack_from('<I',d,32)[0]==len(d)
    assert hashlib.sha1(d[32:]).digest()==d[12:32]
    assert zlib.adler32(d[12:])&0xffffffff==struct.unpack_from('<I',d,8)[0]
    assert struct.unpack_from('<I',d,36)[0]==0x70

def verify_axml(x):
    typ,hs,size=struct.unpack_from('<HHI',x,0);assert (typ,hs,size)==(3,8,len(x))
    off=8; seen=[]
    while off<len(x):
        t,h,s=struct.unpack_from('<HHI',x,off);assert h>=8 and s>=h and off+s<=len(x)
        seen.append(t);off+=s
    assert off==len(x) and 0x0102 in seen and 0x0103 in seen

ICON_APK_PATH='res/mipmap/ic_launcher.png'

def make_apk(root:Path,out:Path):
    dex=DexBuilder().build(); axml=AxmlBuilder().build()
    arsc=ArscBuilder('com.moushana.javaprep',ICON_APK_PATH).build()
    verify_dex(dex);verify_axml(axml);verify_arsc(arsc,ICON_APK_PATH)
    icon_bytes=(root/'assets/icon/ic_launcher.png').read_bytes()
    (root/'build').mkdir(exist_ok=True)
    (root/'build/classes.dex').write_bytes(dex)
    (root/'build/AndroidManifest.xml').write_bytes(axml)
    (root/'build/resources.arsc').write_bytes(arsc)
    unsigned=root/'build/CompileDaily-unsigned.apk'
    with zipfile.ZipFile(unsigned,'w') as z:
        zi=zipfile.ZipInfo('AndroidManifest.xml');zi.compress_type=zipfile.ZIP_STORED;z.writestr(zi,axml)
        zi=zipfile.ZipInfo('resources.arsc');zi.compress_type=zipfile.ZIP_STORED;z.writestr(zi,arsc)
        zi=zipfile.ZipInfo('classes.dex');zi.compress_type=zipfile.ZIP_STORED;z.writestr(zi,dex)
        z.writestr(ICON_APK_PATH,icon_bytes)
        z.write(root/'assets/index.html','assets/index.html',compress_type=zipfile.ZIP_DEFLATED)
    keystore=root/'build/debug.keystore'
    if not keystore.exists():
        subprocess.run(['keytool','-genkeypair','-v','-keystore',str(keystore),'-storepass','android','-alias','androiddebugkey','-keypass','android','-dname','CN=Compile Daily, O=Local Build, C=IN','-keyalg','RSA','-keysize','2048','-validity','10000'],check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    shutil.copy2(unsigned,out)
    subprocess.run(['jarsigner','-keystore',str(keystore),'-storepass','android','-keypass','android','-sigalg','SHA256withRSA','-digestalg','SHA-256',str(out),'androiddebugkey'],check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    subprocess.run(['jarsigner','-verify','-verbose','-certs',str(out)],check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    # Source package for future editing.
    srczip=root/'CompileDaily-Source.zip'
    with zipfile.ZipFile(srczip,'w',zipfile.ZIP_DEFLATED) as z:
        z.write(root/'assets/index.html','assets/index.html')
        z.write(root/'assets/icon/ic_launcher.png','assets/icon/ic_launcher.png')
        z.write(root/'build_apk.py','build_apk.py')
        z.writestr('README.txt','Compile Daily APK source\n\nRun: python build_apk.py --root . --out CompileDaily.apk\nRequires Python 3 and a JDK with keytool/jarsigner. No Android SDK is required.\n')
    return dex,axml,arsc,unsigned,srczip

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',default=str(Path(__file__).resolve().parents[1]));ap.add_argument('--out',default='/mnt/data/CompileDaily.apk');a=ap.parse_args()
    root=Path(a.root);out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
    dex,axml,arsc,unsigned,srczip=make_apk(root,out)
    print(f'Built {out} ({out.stat().st_size} bytes)')
    print(f'DEX {len(dex)} bytes; manifest {len(axml)} bytes; resources.arsc {len(arsc)} bytes; source {srczip}')

if __name__=='__main__':main()
