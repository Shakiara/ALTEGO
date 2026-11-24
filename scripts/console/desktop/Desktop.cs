// ALTEGO necesita conectar los controles de su consola WPF con el supervisor local.
// Este código presenta estados y registros y envía las acciones autorizadas mediante el canal local.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace Altego {
 public static class EntryPoint {
  [STAThread] public static int Main(){try{DevConsole.Run(Environment.GetEnvironmentVariable("ALTEGO_DEV_VIEW"),Environment.GetEnvironmentVariable("ALTEGO_DEV_PIPE"),Environment.GetEnvironmentVariable("ALTEGO_DEV_TOKEN"));return 0;}catch(Exception error){Console.Error.WriteLine("Desktop failed: "+error.GetType().Name+": "+error.Message);return 1;}}
 }

 public class LogEntry {
  public long id {get;set;} public string time {get;set;} public string source {get;set;} public string level {get;set;} public string message {get;set;}
  public Brush color {get{return DevConsole.StatusColor(level);}}
 }
 public class Service {public string status {get;set;} public int? pid {get;set;} public string startedAt {get;set;} public string detail {get;set;}}
 public class Snapshot {public SetupData setup {get;set;} public List<RouteEntry> routes {get;set;} public string routeRevision {get;set;} public string routeMessage {get;set;} public string type {get;set;} public string phase {get;set;} public bool busy {get;set;} public Dictionary<string,Service> services {get;set;} public Dictionary<string,int> ports {get;set;} public string compilation {get;set;} public bool watch {get;set;} public string lastBuild {get;set;} public string critical {get;set;} public List<LogEntry> logs {get;set;}}
 public class ServiceCard {public string name {get;set;} public string status {get;set;} public string address {get;set;} public string extra {get;set;} public Brush color {get{return DevConsole.StatusColor(status);}}}
 public class RouteEntry {public string id {get;set;} public string type {get;set;} public string method {get;set;} public string path {get;set;} public string restrictions {get;set;} public bool navigable {get;set;} public List<string> parameters {get;set;} public string label {get{return type+" · "+method+" "+path;}}}
 public class SetupStep {public string id {get;set;} public string title {get;set;} public string status {get;set;} public string detail {get;set;}}
 public class SetupData {public bool ready {get;set;} public bool busy {get;set;} public bool needsSetup {get;set;} public bool initialChecked {get;set;} public string message {get;set;} public Dictionary<string,string> fields {get;set;} public List<SetupStep> steps {get;set;}}
 public class DevConsole {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd,int command);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
  readonly JavaScriptSerializer serializer=new JavaScriptSerializer {MaxJsonLength=16000000};
  readonly ConcurrentQueue<string> incoming=new ConcurrentQueue<string>();
  readonly ObservableCollection<LogEntry> shown=new ObservableCollection<LogEntry>();
  readonly List<LogEntry> history=new List<LogEntry>();
  Window window; NamedPipeClientStream pipe;StreamWriter writer;DispatcherTimer timer;Snapshot snapshot;
  ListBox navigation,logs,recent;ComboBox source,level;TextBox search;Button start,stop,restart,pause;CheckBox autoscroll;
  string routeRevision; bool formLoaded,setupShown; readonly Dictionary<string,TextBox> routeInputs=new Dictionary<string,TextBox>();
  bool allowClose,closing,paused,disconnected;int bytes,lastQueued;DateTime lastMessage=DateTime.UtcNow;
  public static Brush StatusColor(string status){return (Brush)new BrushConverter().ConvertFromString(status=="Online"||status=="Success"?"#9BD6B9":status=="Error"?"#F0A6B0":status=="Starting"||status=="Stopping"||status=="Warning"?"#E8CC94":"#8998B1");}
  T Find<T>(string name) where T:class {return window.FindName(name) as T;}
  public static void Run(string xaml,string pipeName,string token){new DevConsole().Open(xaml,pipeName,token);}
  void Open(string xaml,string pipeName,string token){
   try{SetThreadDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
   using(var stream=File.OpenRead(xaml))window=(Window)XamlReader.Load(stream);
   window.Icon=BitmapFrame.Create(new Uri(Environment.GetEnvironmentVariable("ALTEGO_DEV_ICON")));
   window.Loaded+=(s,e)=>window.Dispatcher.BeginInvoke(new Action(()=>{ShowWindow(new WindowInteropHelper(window).Handle,5);window.Activate();}),DispatcherPriority.ApplicationIdle);
   window.SourceInitialized+=(s,e)=>{int dark=1;DwmSetWindowAttribute(new WindowInteropHelper(window).Handle,20,ref dark,4);};
   navigation=Find<ListBox>("Navigation");logs=Find<ListBox>("Logs");recent=Find<ListBox>("Recent");source=Find<ComboBox>("Source");level=Find<ComboBox>("Level");search=Find<TextBox>("Search");start=Find<Button>("Start");stop=Find<Button>("Stop");restart=Find<Button>("Restart");pause=Find<Button>("Pause");autoscroll=Find<CheckBox>("Autoscroll");
   logs.ItemsSource=shown;CollectionViewSource.GetDefaultView(shown).Filter=Matches;source.SelectedIndex=0;level.SelectedIndex=0;
   navigation.SelectionChanged+=(s,e)=>RefreshPage();source.SelectionChanged+=(s,e)=>Filter();level.SelectionChanged+=(s,e)=>Filter();search.TextChanged+=(s,e)=>Filter();
   pause.Click+=(s,e)=>{paused=!paused;pause.Content=paused?"Resume":"Pause";if(!paused)Rebuild();Filter();};
   start.Click+=(s,e)=>Control("start");stop.Click+=(s,e)=>Control("stop");restart.Click+=(s,e)=>Control("restart");
   SetupControls();
   window.Closing+=(s,e)=>{if(snapshot!=null&&snapshot.setup!=null&&snapshot.setup.busy){e.Cancel=true;Find<TextBlock>("SetupMessage").Text="Wait for the current installation step to finish before closing.";return;}if(!allowClose){e.Cancel=true;if(!closing){closing=true;Control("shutdown");window.Title="ALTEGO Dev Console — Stopping…";Find<TextBlock>("Footer").Text="Stopping owned services before closing…";}}};
   window.Closed+=(s,e)=>{timer.Stop();if(pipe!=null)pipe.Dispose();};
   timer=new DispatcherTimer {Interval=TimeSpan.FromMilliseconds(200)};timer.Tick+=(s,e)=>Tick();timer.Start();
   var readerThread=new Thread(()=>Read(pipeName,token)){IsBackground=true};readerThread.Start();RefreshPage();window.ShowDialog();
  }
  void Read(string pipeName,string token){try{
   pipe=new NamedPipeClientStream(".",pipeName,PipeDirection.InOut,PipeOptions.Asynchronous);pipe.Connect(15000);writer=new StreamWriter(pipe,new UTF8Encoding(false)){AutoFlush=true};
   writer.WriteLine(new JavaScriptSerializer().Serialize(new {type="attach",token=token}));
   using(var reader=new StreamReader(pipe,Encoding.UTF8)){string line;while((line=reader.ReadLine())!=null){if(line.Length>16000000||Interlocked.Increment(ref lastQueued)>100)throw new IOException("Desktop update queue overflow.");incoming.Enqueue(line);}}
  }catch(Exception error){incoming.Enqueue(new JavaScriptSerializer().Serialize(new {type="disconnected",reason=error.GetType().Name}));Interlocked.Increment(ref lastQueued);}finally{disconnected=true;}}
  void Send(object message){if(writer==null)return;try{lock(writer)writer.WriteLine(serializer.Serialize(message));}catch{disconnected=true;}}
  void Control(string action){start.IsEnabled=false;stop.IsEnabled=false;restart.IsEnabled=false;Send(new {type="control",action=action});}
  void Tick(){
   string line;bool changed=false;int count=0;
   while(count++<35&&incoming.TryDequeue(out line)){Interlocked.Decrement(ref lastQueued);lastMessage=DateTime.UtcNow;
    try{var kind=serializer.Deserialize<Dictionary<string,object>>(line);string type=Convert.ToString(kind["type"]);
     if(type=="closed"){allowClose=true;window.Close();return;}
     if(type=="open"){Uri url;string value=Convert.ToString(kind["url"]);if(Uri.TryCreate(value,UriKind.Absolute,out url)&&url.Scheme=="http"&&url.Host=="localhost"&&String.IsNullOrEmpty(url.UserInfo)&&snapshot!=null&&(url.Port==snapshot.ports["api"]||url.Port==snapshot.ports["web"]))Process.Start(new ProcessStartInfo(value){UseShellExecute=true});continue;}
     if(type=="focus"){if(window.WindowState==WindowState.Minimized)window.WindowState=WindowState.Normal;window.Activate();window.Topmost=true;window.Topmost=false;continue;}
     if(type=="disconnected"){disconnected=true;continue;}
     if(type!="snapshot")continue;snapshot=serializer.Deserialize<Snapshot>(line);
     foreach(var entry in snapshot.logs??new List<LogEntry>()){if(history.Count>0&&entry.id<=history[history.Count-1].id)continue;history.Add(entry);bytes+=entry.message.Length;if(!paused)shown.Add(entry);}
     while(history.Count>2500||bytes>2000000){bytes-=history[0].message.Length;history.RemoveAt(0);}
     if(!paused)while(shown.Count>0&&(shown.Count>2500||history.Count>0&&shown[0].id<history[0].id))shown.RemoveAt(0);
     changed=true;
    }catch(Exception error){Find<TextBlock>("Footer").Text="Invalid supervisor update: "+error.GetType().Name;}
   }
   if(changed){RenderState();Filter();if(!paused&&autoscroll.IsChecked==true&&logs.Items.Count>0)logs.ScrollIntoView(logs.Items[logs.Items.Count-1]);}
   if(disconnected||DateTime.UtcNow-lastMessage>TimeSpan.FromSeconds(15)){Find<TextBlock>("Connection").Text="Disconnected";Find<TextBlock>("Connection").Foreground=StatusColor("Error");start.IsEnabled=stop.IsEnabled=restart.IsEnabled=false;Find<TextBlock>("Footer").Text="Supervisor connection lost. The desktop will close; inspect the terminal.";if(DateTime.UtcNow-lastMessage>TimeSpan.FromSeconds(18)){allowClose=true;window.Close();}}
  }
  void Rebuild(){shown.Clear();foreach(var entry in history)shown.Add(entry);}
  string Selected(ComboBox combo){var item=combo.SelectedItem as ComboBoxItem;return item==null?"All":Convert.ToString(item.Content);}
  bool Matches(object value){var entry=value as LogEntry;if(entry==null)return false;string tab=Tab(),filterSource=Selected(source),filterLevel=Selected(level);if(tab=="API Server"&&entry.source!="API"||tab=="Frontend"&&entry.source!="Frontend"||tab=="Databases"&&entry.source!="Databases")return false;return(filterSource=="All"||entry.source==filterSource)&&(filterLevel=="All"||entry.level==filterLevel)&&(String.IsNullOrEmpty(search.Text)||entry.message.IndexOf(search.Text,StringComparison.OrdinalIgnoreCase)>=0);}
  void Filter(){if(logs==null||source==null||level==null||search==null)return;CollectionViewSource.GetDefaultView(shown).Refresh();Find<TextBlock>("Empty").Visibility=logs.Items.Count==0?Visibility.Visible:Visibility.Collapsed;}
  string Tab(){var item=navigation.SelectedItem as ListBoxItem;return item==null?"Overview":Convert.ToString(item.Content);}
  void RefreshPage(){string tab=Tab();Find<TextBlock>("PageTitle").Text=tab;Find<Grid>("Overview").Visibility=tab=="Overview"?Visibility.Visible:Visibility.Collapsed;Find<Grid>("LogsPanel").Visibility=tab=="Overview"||tab=="Route Explorer"||tab=="Setup & Installation"?Visibility.Collapsed:Visibility.Visible;Find<Grid>("RoutesPanel").Visibility=tab=="Route Explorer"?Visibility.Visible:Visibility.Collapsed;Find<ScrollViewer>("SetupPanel").Visibility=tab=="Setup & Installation"?Visibility.Visible:Visibility.Collapsed;Find<Border>("ServiceInfoPanel").Visibility=tab=="API Server"||tab=="Frontend"||tab=="Databases"?Visibility.Visible:Visibility.Collapsed;RenderState();Filter();}
  string Age(Service service){DateTime start;if(!DateTime.TryParse(service.startedAt,out start))return "";var span=DateTime.UtcNow-start.ToUniversalTime();return "Up "+((int)span.TotalHours>0?((int)span.TotalHours)+"h ":"")+span.Minutes+"m "+span.Seconds+"s";}
  string Address(string key){if(snapshot==null)return "";return key=="API"?"http://localhost:"+snapshot.ports["api"]:key=="Frontend"?"http://localhost:"+snapshot.ports["web"]:key=="MySQL"?"ALTEGO database connection":"ALTEGO document database connection";}
  void RenderState(){if(snapshot==null)return;bool busy=snapshot.busy||closing;start.IsEnabled=!busy&&snapshot.phase=="Offline"&&snapshot.setup!=null&&snapshot.setup.ready;stop.IsEnabled=!busy&&snapshot.phase=="Running";restart.IsEnabled=!busy&&snapshot.phase=="Running";
   Find<TextBlock>("SessionState").Text=snapshot.phase+" · supervised local processes";Find<TextBlock>("Connection").Text="Connected";Find<TextBlock>("Connection").Foreground=StatusColor("Online");
   var cards=new List<ServiceCard>();foreach(var pair in snapshot.services){var service=pair.Value;cards.Add(new ServiceCard {name=pair.Key=="API"?"API Server":pair.Key=="Frontend"?"Angular Frontend":pair.Key,status=service.status,address=Address(pair.Key),extra=!String.IsNullOrEmpty(service.detail)?service.detail:(service.pid.HasValue?"PID "+service.pid.Value+" · "+Age(service):"Read-only connectivity check")});}Find<ItemsControl>("Services").ItemsSource=cards;
   Find<TextBlock>("Build").Text=snapshot.compilation+(String.IsNullOrEmpty(snapshot.lastBuild)?"":" · "+snapshot.lastBuild);Find<TextBlock>("Build").Foreground=StatusColor(snapshot.compilation=="Failed"?"Error":snapshot.compilation);Find<TextBlock>("Watch").Text=snapshot.watch?"Angular watching for changes":"Not active";
   var latestWarning=history.LastOrDefault(e=>e.level=="Warning");string alert=String.IsNullOrEmpty(snapshot.critical)?(latestWarning==null?"":latestWarning.message):snapshot.critical;Find<Border>("AlertPanel").Visibility=String.IsNullOrEmpty(alert)?Visibility.Collapsed:Visibility.Visible;Find<TextBlock>("Alert").Text=alert;
   recent.ItemsSource=history.Where(e=>e.source!="Frontend"||e.level!="Info").Reverse().Take(8).ToList();Find<TextBlock>("Footer").Text=(paused?"View paused · ":"")+history.Count+" recent records retained · filters do not change the original history";
   RenderTools();
   string tab=Tab();if(tab=="API Server"||tab=="Frontend"){string key=tab=="API Server"?"API":"Frontend";var service=snapshot.services[key];Find<TextBlock>("ServiceInfo").Text=service.status+" · "+Address(key)+(service.pid.HasValue?" · PID "+service.pid:"");Find<TextBlock>("ServiceNote").Text=key=="API"?"Backend source changes require Restart Servers.":"Build: "+snapshot.compilation+" · "+(snapshot.watch?"Watch mode enabled":"Watch mode not confirmed")+(String.IsNullOrEmpty(snapshot.lastBuild)?"":" · Last build "+snapshot.lastBuild);}
   if(tab=="Databases"){Find<TextBlock>("ServiceInfo").Text="MySQL: "+snapshot.services["MySQL"].status+" · MongoDB: "+snapshot.services["MongoDB"].status;Find<TextBlock>("ServiceNote").Text="Connections are checked separately. Global database services are not started or stopped.";}
  }
  void SetupControls(){
   Find<ComboBox>("RouteType").SelectedIndex=0;Find<ComboBox>("RouteMethod").SelectedIndex=0;
   Find<ComboBox>("RouteType").SelectionChanged+=(s,e)=>FilterRoutes();Find<ComboBox>("RouteMethod").SelectionChanged+=(s,e)=>FilterRoutes();Find<TextBox>("RouteSearch").TextChanged+=(s,e)=>FilterRoutes();Find<ListBox>("RouteList").SelectionChanged+=(s,e)=>SelectRoute();Find<Button>("RefreshRoutes").Click+=(s,e)=>Send(new {type="routes"});
   Find<Button>("OpenRoute").Click+=(s,e)=>{var route=Find<ListBox>("RouteList").SelectedItem as RouteEntry;if(route==null)return;Send(new {type="navigate",id=route.id,parameters=routeInputs.ToDictionary(p=>p.Key,p=>p.Value.Text)});};
   Find<Button>("CheckRequirements").Click+=(s,e)=>Send(new {type="setup",action="requirements"});
   Find<Button>("InstallDependencies").Click+=(s,e)=>{if(MessageBox.Show(window,"Install project packages using npm ci? Existing node_modules will be rebuilt. No system software is installed.","Install Dependencies",MessageBoxButton.YesNo,MessageBoxImage.Question,MessageBoxResult.No)==MessageBoxResult.Yes)Send(new {type="setup",action="dependencies"});};
   Find<Button>("ConfigureEnvironment").Click+=(s,e)=>Find<Expander>("EnvironmentForm").IsExpanded=true;
   Find<Button>("InitializeDatabases").Click+=(s,e)=>{if(snapshot==null||snapshot.setup==null)return;var f=snapshot.setup.fields;if(MessageBox.Show(window,"Initialize NEW destinations?\nMySQL: "+f["mysqlDatabase"]+"\nMongoDB: "+f["mongoDatabase"]+"\nStorage: "+f["storage"]+"\nExisting databases and files will be refused. This is not an upgrade or reset.","Confirm new installation",MessageBoxButton.YesNo,MessageBoxImage.Warning,MessageBoxResult.No)==MessageBoxResult.Yes)Send(new {type="setup",action="initialize",confirmation="INITIALIZE_NEW_DESTINATIONS"});};
   Find<Button>("VerifyInstallation").Click+=(s,e)=>Send(new {type="setup",action="verify"});Find<Button>("SetupStart").Click+=(s,e)=>Control("start");
   Find<Button>("SaveEnvironment").Click+=(s,e)=>{if(MessageBox.Show(window,"Save local configuration? An existing .env will be preserved as a backup before replacement. No database or Storage files are modified.","Save configuration",MessageBoxButton.YesNo,MessageBoxImage.Question,MessageBoxResult.No)!=MessageBoxResult.Yes)return;var fields=new Dictionary<string,string>();foreach(string key in new[]{"mysqlHost","mysqlPort","mysqlUser","mysqlDatabase","mongoDatabase","storage","apiPort","webPort"})fields[key]=Find<TextBox>("Env_"+key).Text;fields["mysqlPassword"]=Find<PasswordBox>("Env_mysqlPassword").Password;fields["mongoUri"]=Find<PasswordBox>("Env_mongoUri").Password;Send(new {type="setup",action="environment",fields=fields,replace=true});Find<PasswordBox>("Env_mysqlPassword").Clear();Find<PasswordBox>("Env_mongoUri").Clear();};
  }
  void FilterRoutes(){if(snapshot==null||snapshot.routes==null)return;var list=Find<ListBox>("RouteList");string id=(list.SelectedItem as RouteEntry)==null?null:((RouteEntry)list.SelectedItem).id;string type=Selected(Find<ComboBox>("RouteType")),method=Selected(Find<ComboBox>("RouteMethod")),query=Find<TextBox>("RouteSearch").Text;var rows=snapshot.routes.Where(r=>(type=="All"||r.type==type)&&(method=="All"||r.method==method)&&(String.IsNullOrEmpty(query)||(r.path+" "+r.restrictions).IndexOf(query,StringComparison.OrdinalIgnoreCase)>=0)).ToList();list.ItemsSource=rows;list.SelectedItem=rows.FirstOrDefault(r=>r.id==id);Find<TextBlock>("RouteMessage").Text=rows.Count+" matching routes · "+snapshot.routeMessage;}
  void SelectRoute(){routeInputs.Clear();var panel=Find<WrapPanel>("RouteParameters");panel.Children.Clear();var route=Find<ListBox>("RouteList").SelectedItem as RouteEntry;Find<Button>("OpenRoute").IsEnabled=route!=null&&route.navigable;if(route==null)return;Find<TextBlock>("RouteMessage").Text=route.restrictions;foreach(string key in route.parameters??new List<string>()){var stack=new StackPanel {Width=160,Margin=new Thickness(0,0,10,8)};stack.Children.Add(new TextBlock {Text=key,Foreground=StatusColor("Starting"),Margin=new Thickness(0,0,0,4)});var input=new TextBox();System.Windows.Automation.AutomationProperties.SetName(input,"Route parameter "+key);stack.Children.Add(input);routeInputs[key]=input;panel.Children.Add(stack);}}
  void RenderTools(){if(snapshot.setup==null)return;var setup=snapshot.setup;Find<TextBlock>("SetupMessage").Text=setup.message;Find<ItemsControl>("SetupSteps").ItemsSource=setup.steps;bool available=!snapshot.busy&&snapshot.phase=="Offline";foreach(string key in new[]{"CheckRequirements","InstallDependencies","ConfigureEnvironment","InitializeDatabases","VerifyInstallation","SaveEnvironment"})Find<Button>(key).IsEnabled=available;Find<Button>("SetupStart").IsEnabled=available&&setup.ready;
   if(!formLoaded&&setup.initialChecked&&setup.fields!=null){foreach(var field in setup.fields){var box=Find<TextBox>("Env_"+field.Key);if(box!=null)box.Text=field.Value;}formLoaded=true;}
   if(!setupShown&&setup.initialChecked){setupShown=true;if(setup.needsSetup)navigation.SelectedIndex=6;}
   if(routeRevision!=snapshot.routeRevision){routeRevision=snapshot.routeRevision;FilterRoutes();}if(snapshot.routes==null||snapshot.routes.Count==0)Find<TextBlock>("RouteMessage").Text=snapshot.routeMessage;
  }

 }
}
