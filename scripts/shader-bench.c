// Times one fragment shader on the GPU, headless: a full-screen quad into a
// W x H framebuffer, FRAMES times, with GL_TIME_ELAPSED around each draw.
// Prints the mean milliseconds per frame. Built and driven by shaders.mjs.
//
//   shader-bench shader.frag uniforms.txt W H FRAMES
//
// uniforms.txt holds one "name components v1 v2 ..." per line. u_res and
// u_time are set here: the size, and a clock that advances a 60th a frame.
#include <EGL/egl.h>
#include <EGL/eglext.h>
#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glext.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *slurp(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    rewind(f);
    char *s = malloc(n + 1);
    if (fread(s, 1, n, f) != (size_t)n) { perror(path); exit(1); }
    s[n] = 0;
    fclose(f);
    return s;
}

static GLuint compile(GLenum type, const char *src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[8192];
        glGetShaderInfoLog(s, sizeof log, NULL, log);
        fprintf(stderr, "compile: %s\n", log);
        exit(1);
    }
    return s;
}

// A GL 3.3 context on the first EGL device that is real hardware: with glvnd
// the default display can be a vendor that has no driver for this GPU.
static int make_context(void) {
    PFNEGLQUERYDEVICESEXTPROC query = (void *)eglGetProcAddress("eglQueryDevicesEXT");
    PFNEGLGETPLATFORMDISPLAYEXTPROC display_for = (void *)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDeviceEXT devices[16];
    EGLint count = 0;
    if (!query || !display_for || !query(16, devices, &count)) return 0;

    for (int i = 0; i < count; i++) {
        EGLDisplay dpy = display_for(EGL_PLATFORM_DEVICE_EXT, devices[i], NULL);
        if (!eglInitialize(dpy, NULL, NULL)) continue;
        eglBindAPI(EGL_OPENGL_API);
        EGLint attr[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE };
        EGLConfig cfg;
        EGLint n = 0;
        if (!eglChooseConfig(dpy, attr, &cfg, 1, &n) || n < 1) continue;
        EGLint ctxAttr[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 3,
                             EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE };
        EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctxAttr);
        if (ctx == EGL_NO_CONTEXT || !eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx)) continue;
        const char *renderer = (const char *)glGetString(GL_RENDERER);
        if (!renderer || strstr(renderer, "llvmpipe") || strstr(renderer, "softpipe")) continue;
        fprintf(stderr, "renderer: %s\n", renderer);
        return 1;
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 6) { fprintf(stderr, "usage: shader-bench shader.frag uniforms.txt W H FRAMES\n"); return 1; }
    int W = atoi(argv[3]), H = atoi(argv[4]), frames = atoi(argv[5]);
    if (!make_context()) { fprintf(stderr, "no hardware GL context\n"); return 1; }

    const char *vs =
        "#version 330\n"
        "layout(location = 0) in vec2 pos;\n"
        "out vec4 cogl_tex_coord_in[1];\n"
        "out vec4 cogl_color_in;\n"
        "void main() {\n"
        "    cogl_tex_coord_in[0] = vec4(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5, 0.0, 1.0);\n"
        "    cogl_color_in = vec4(1.0);\n"
        "    gl_Position = vec4(pos, 0.0, 1.0);\n"
        "}\n";
    GLuint prog = glCreateProgram();
    glAttachShader(prog, compile(GL_VERTEX_SHADER, vs));
    glAttachShader(prog, compile(GL_FRAGMENT_SHADER, slurp(argv[1])));
    glLinkProgram(prog);
    glUseProgram(prog);

    GLuint tex, fbo;
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    glViewport(0, 0, W, H);

    float quad[] = { -1, -1, 1, -1, -1, 1, 1, 1 };
    GLuint vao, vbo;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    glGenBuffers(1, &vbo);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof quad, quad, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);

    FILE *u = fopen(argv[2], "r");
    if (!u) { perror(argv[2]); return 1; }
    char name[128];
    int comps;
    static float v[4096];
    while (fscanf(u, "%127s %d", name, &comps) == 2) {
        int count = 0;
        char c = 0;
        while (count < 4096 && fscanf(u, "%f%c", &v[count], &c) == 2) {
            count++;
            if (c == '\n') break;
        }
        GLint loc = glGetUniformLocation(prog, name);
        if (loc < 0 || comps < 1 || comps > 4) continue;
        int k = count / comps;
        if (comps == 1) glUniform1fv(loc, k, v);
        else if (comps == 2) glUniform2fv(loc, k, v);
        else if (comps == 3) glUniform3fv(loc, k, v);
        else glUniform4fv(loc, k, v);
    }
    fclose(u);
    glUniform2f(glGetUniformLocation(prog, "u_res"), W, H);
    GLint time = glGetUniformLocation(prog, "u_time");

    // Two queries in flight, each read a frame late, so reading one never
    // stalls the frame being timed. The first frames warm the clocks up.
    GLuint q[2];
    glGenQueries(2, q);
    double total = 0;
    int counted = 0;
    for (int i = 0; i < frames; i++) {
        glUniform1f(time, 100.0f + i / 60.0f);
        glBeginQuery(GL_TIME_ELAPSED, q[i & 1]);
        glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        glEndQuery(GL_TIME_ELAPSED);
        if (i > 20) {
            GLuint64 ns;
            glGetQueryObjectui64v(q[(i - 1) & 1], GL_QUERY_RESULT, &ns);
            total += ns;
            counted++;
        }
    }
    glFinish();
    printf("%.3f\n", total / counted / 1e6);
    return 0;
}
