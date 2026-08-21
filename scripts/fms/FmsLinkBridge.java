import fmsclient.fmsDataPkg;
import fmsclient.fmsLinkUtil;
import java.io.BufferedReader;
import java.io.InputStreamReader;

/** kistec_v2.1.jar POST bridge — stdout first line (0000|path|msg) */
public class FmsLinkBridge {
    public static void main(String[] args) throws Exception {
        if (args.length < 5) {
            System.err.println("Usage: FmsLinkBridge orgCode userId pswd certiKey identifier");
            System.exit(2);
        }
        fmsDataPkg pkg = new fmsDataPkg();
        pkg.orgCode = args[0];
        pkg.userId = args[1];
        pkg.pswd = args[2];
        pkg.certiKey = args[3];
        pkg.reqMethod = args[4];
        pkg.approveReqYn = "N";
        pkg.sendContent = null;

        BufferedReader br = new BufferedReader(
                new InputStreamReader(fmsLinkUtil.receivePostMessage(pkg), "UTF-8"));
        String line = br.readLine();
        br.close();
        if (line == null || line.trim().isEmpty()) {
            System.exit(1);
        }
        byte[] bytes = line.trim().getBytes("UTF-8");
        System.out.write(bytes);
        System.out.write('\n');
        System.out.flush();
    }
}
