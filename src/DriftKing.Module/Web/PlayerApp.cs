using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;

namespace DriftKing.Web;

/// <summary>
/// The player app: one static page (<c>wwwroot/index.html</c>, the same file the app shell loads from its own files) for <c>/driftking/</c>
/// (invitations: <c>/driftking/?raum=ABCD</c>). On the master the page gets the version of the plugin in its meta tag <c>matgame-version</c> (the app shell names its own).
/// Everything else (scripts, styles, pictures) is a static web asset of the plugin under <c>/driftking/</c>; the car models (<c>.glb</c>, a type the
/// static files middleware does not serve) come through <see cref="CarModel"/>.
/// </summary>
public static class PlayerApp
{
    private const string VersionPlaceholder = "<meta name=\"matgame-version\" content=\"\" />";

    public static void Map(IEndpointRouteBuilder game, string basePath)
    {
        game.MapGet("/", (HttpContext http, IWebHostEnvironment env) => Serve(http, env, basePath)).AllowAnonymous();
        game.MapGet("/models/cars/{file}", (string file, HttpContext http, IWebHostEnvironment env) => CarModel(http, env, basePath, file)).AllowAnonymous();
    }

    /// <summary>
    /// A car model (<c>wwwroot/models/cars/&lt;key&gt;.glb</c>): the static files middleware does not know <c>.glb</c>, so the models come through here.
    /// The app asks with <c>?v=&lt;hash of the file&gt;</c> (data/car-models.json): such an address never changes its content.
    /// </summary>
    private static IResult CarModel(HttpContext http, IWebHostEnvironment env, string basePath, string file)
    {
        var name = file.EndsWith(".glb", StringComparison.Ordinal) ? file[..^4] : string.Empty;
        if (name.Length is 0 or > 40 || !name.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c is '-' or '_'))
        {
            return Results.NotFound();
        }

        var info = env.WebRootFileProvider.GetFileInfo($"{basePath.TrimStart('/')}/models/cars/{file}");
        if (!info.Exists)
        {
            return Results.NotFound();
        }

        http.Response.Headers.CacheControl = http.Request.Query.ContainsKey("v") ? "public, max-age=31536000, immutable" : "no-cache";
        var tag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{info.Length:x}-{info.LastModified.UtcTicks:x}\"");
        return Results.File(info.CreateReadStream(), "model/gltf-binary", lastModified: info.LastModified, entityTag: tag);
    }

    private static IResult Serve(HttpContext http, IWebHostEnvironment env, string basePath)
    {
        // the page uses addresses relative to <base href="/driftking/">: "/driftking" alone becomes "/driftking/"
        var path = http.Request.Path.Value ?? string.Empty;
        if (path.Equals(basePath, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Redirect(basePath + "/" + http.Request.QueryString);
        }

        var file = env.WebRootFileProvider.GetFileInfo(basePath.TrimStart('/') + "/index.html");
        if (!file.Exists)
        {
            return Results.NotFound("DriftKing: index.html fehlt.");
        }

        using var reader = new StreamReader(file.CreateReadStream(), Encoding.UTF8);
        var html = reader.ReadToEnd().Replace(VersionPlaceholder, $"<meta name=\"matgame-version\" content=\"{System.Net.WebUtility.HtmlEncode(AppInfo.Version)}\" />",
            StringComparison.Ordinal);
        http.Response.Headers.CacheControl = "no-cache";
        return Results.Content(html, "text/html; charset=utf-8");
    }
}
